import json
import logging
import os
import re

from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..models import Turn
from ..scenarios import Scenario, ScenarioDraft, scenario_instructions

logger = logging.getLogger(__name__)

STRUCTURED_INSTRUCTIONS = """Return only one JSON object with the following shape:
{"reply_en":"Could you tell me a little more?","translation_zh":"可以再多说一点吗？","correction":"","suggested_phrase":"Sure, let me explain.","goal_matches":[]}
reply_en must always contain your short English reply, even when the learner's words
are unclear. translation_zh translates that reply into Simplified Chinese. correction
is at most one short Chinese grammar suggestion, or an empty string. Do not present
a suspected speech-recognition error as a definite grammar mistake. suggested_phrase
is one short English response the learner might use next. Never return an empty reply.
Return every field on every turn, including a Chinese translation, even when closing
the conversation. The JSON structure is mandatory; do not return plain English alone.
Write reply_en as natural spoken dialogue: use ordinary words and contractions where
appropriate. Avoid ampersands, slash-separated alternatives, bullet points, emoji,
and letter-by-letter abbreviations that sound awkward when read aloud.
Also return goal_matches: an array of {"index":0,"evidence":"exact quote from a learner turn"}.
index is 0 for the first objective, 1 for the second, or 2 for the third. Only include an objective actually
achieved by the learner's words, never from your own reply or from turn count.
"""

PLAIN_INSTRUCTIONS = """For this turn, reply only with 1-3 short English sentences as
your assigned role. Do not output JSON, analysis, labels, translations, or a grammar lesson.
Use natural spoken English and avoid symbols or slash-separated alternatives.
If you cannot confidently understand the learner's words, ask one short clarification
question using your previous question for context. A single word, unfinished
sentence, or misrecognized phrase is still a valid learner turn. Never stay silent.
"""


class ReplyFormatError(ValueError):
    """A completed API request did not contain a usable spoken answer."""


class ConversationServiceError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class AssistantReply(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reply_en: str = Field(min_length=1, max_length=2000)
    translation_zh: str = ""
    correction: str = ""
    suggested_phrase: str = ""
    goal_matches: list["GoalMatch"] = Field(default_factory=list)

    @field_validator("reply_en")
    @classmethod
    def spoken_english_only(cls, value):
        if not re.search(r"[A-Za-z]{2,}", value) or re.search(r"[\u3400-\u9fff]", value) or value.startswith(("{", "[", "```", "<")):
            raise ValueError("Reply must contain spoken English only")
        return value

    @field_validator("translation_zh", "correction", "suggested_phrase", mode="before")
    @classmethod
    def empty_optional_fields(cls, value):
        return "" if value is None else value


class GoalMatch(BaseModel):
    index: int = Field(ge=0, le=2)
    evidence: str = Field(min_length=1, max_length=1000)


class GoalAssessment(BaseModel):
    goal_matches: list[GoalMatch] = Field(max_length=3)


class ReviewSpotlight(BaseModel):
    original: str = Field(min_length=1, max_length=500)
    improved: str = Field(min_length=1, max_length=500)
    explanation: str = Field(min_length=1, max_length=500)


class PracticeReview(BaseModel):
    summary: str = Field(min_length=1, max_length=3000)
    strengths: list[str] = Field(max_length=8)
    improvements: list[str] = Field(max_length=8)
    next_practice: str = Field(min_length=1, max_length=2000)
    spotlight: ReviewSpotlight | None = None

    @field_validator("summary", "next_practice")
    @classmethod
    def chinese_review(cls, value):
        if not re.search(r"[\u3400-\u9fff]", value): raise ValueError("必须用简体中文写复盘和建议，可引用英文例句。")
        return value


def parse_assistant_reply(content: str) -> AssistantReply:
    cleaned = content.strip()
    if not cleaned:
        raise ReplyFormatError("empty_content")
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL | re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        # Never read a truncated JSON object or reasoning block aloud as dialogue.
        if fenced or cleaned.startswith(("{", "[", "```", "<")) or "\"reply_en\"" in cleaned:
            raise ReplyFormatError("malformed_content") from exc
        return AssistantReply(reply_en=cleaned)
    if not isinstance(payload, dict):
        raise ReplyFormatError("expected_object")
    try:
        return AssistantReply.model_validate(payload)
    except ValueError as exc:
        raise ReplyFormatError("invalid_reply_fields") from exc


def dialogue_history(history: list[Turn], *, structured: bool) -> list[dict[str, str]]:
    # A failed request leaves an unanswered user turn in SQLite. Keep the audit
    # record there, but only send the latest retry in each consecutive user block.
    turns: list[Turn] = []
    for turn in history:
        if turn.role not in ("user", "assistant"):
            continue
        if turn.role == "user" and turns and turns[-1].role == "user":
            turns[-1] = turn
        else:
            turns.append(turn)
    messages = []
    for turn in turns[-12:]:
        content = turn.text
        if structured and turn.role == "assistant":
            content = AssistantReply(
                reply_en=turn.text,
                translation_zh=turn.translation,
                correction=turn.correction,
                suggested_phrase=turn.suggested_phrase,
            ).model_dump_json(exclude={"goal_matches"})
        messages.append({"role": turn.role, "content": content})
    return messages


class DeepSeekService:
    def __init__(self, api_key: str | None = None, model: str = "deepseek-v4-flash") -> None:
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY", "")
        self.model = os.getenv("DEEPSEEK_MODEL", model)
        self.client = (
            AsyncOpenAI(
                api_key=self.api_key,
                base_url="https://api.deepseek.com",
                timeout=25.0,
                max_retries=0,  # Retries are bounded and change strategy below.
            )
            if self.api_key else None
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def reply(self, scenario: Scenario, history: list[Turn]) -> AssistantReply:
        if not self.client:
            raise ConversationServiceError("llm_not_configured", "对话服务尚未完成本机预配置，请运行项目配置脚本。", retryable=False)

        for attempt in range(2):
            structured = attempt == 0
            instructions = STRUCTURED_INSTRUCTIONS if structured else PLAIN_INSTRUCTIONS
            messages = [{"role": "system", "content": scenario_instructions(scenario) + "\n\n" + instructions}]
            # Prior turns are spoken text, not JSON examples that could bias goal output.
            messages.extend(dialogue_history(history, structured=False))
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,  # type: ignore[arg-type]
                    temperature=0.4,
                    max_tokens=1200 if structured else 400,
                    # Request JSON in the prompt, not in DeepSeek's constrained
                    # JSON mode, which can return empty content on valid input.
                    response_format={"type": "text"},
                    extra_body={"thinking": {"type": "disabled"}},
                )
                choice = response.choices[0] if response.choices else None
                content = (choice.message.content or "") if choice else ""
                # Log only API metadata, never keys, conversation text or reasoning.
                logger.info(
                    "DeepSeek mode=%s finish=%s content_chars=%d completion_tokens=%s",
                    "structured_prompt" if structured else "plain_retry",
                    choice.finish_reason if choice else "no_choices",
                    len(content),
                    response.usage.completion_tokens if response.usage else None,
                )
                if choice and choice.finish_reason == "length":
                    raise ReplyFormatError("truncated_content")
                reply = parse_assistant_reply(content)
                return reply
            except ReplyFormatError as exc:
                logger.warning("DeepSeek unusable reply attempt=%d reason=%s", attempt + 1, exc)
                if attempt == 1:
                    raise ConversationServiceError(
                        "llm_empty_reply",
                        "语音或文字已收到，但对话服务没有返回有效回复。请重试；这不代表你的英语有问题。",
                    ) from exc
            except (APITimeoutError, APIConnectionError) as exc:
                logger.warning("DeepSeek connection failure attempt=%d type=%s", attempt + 1, type(exc).__name__)
                if attempt == 1:
                    raise ConversationServiceError(
                        "llm_connection", "对话服务连接超时或网络中断，请检查网络后重试。"
                    ) from exc
            except APIStatusError as exc:
                status = exc.status_code
                logger.warning("DeepSeek HTTP failure attempt=%d status=%d", attempt + 1, status)
                if status in (401, 403):
                    raise ConversationServiceError(
                        "llm_auth", "DeepSeek 预配置无效或没有访问权限，请重新运行项目配置脚本。", retryable=False
                    ) from exc
                if status == 402:
                    raise ConversationServiceError(
                        "llm_balance", "DeepSeek 账户余额不足，请检查账户余额后重试。", retryable=False
                    ) from exc
                if status == 429:
                    raise ConversationServiceError("llm_rate_limit", "对话服务请求过于频繁，请稍后再试。") from exc
                if status >= 500 and attempt == 0:
                    continue
                raise ConversationServiceError(
                    "llm_request", f"对话服务暂时无法处理请求（HTTP {status}），请稍后重试。"
                ) from exc
        raise ConversationServiceError("llm_unavailable", "对话服务暂时不可用，请稍后重试。")

    async def structured(self, instruction: str, user_content: str, schema):
        if not self.client:
            raise ConversationServiceError("llm_not_configured", "请先完成项目服务预配置。", retryable=False)
        messages = [{"role": "system", "content": instruction + " Return only JSON matching every constraint in this schema: " + json.dumps(schema.model_json_schema(), ensure_ascii=False)}, {"role": "user", "content": user_content}]
        for attempt in range(2):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model, messages=messages, temperature=0.3, max_tokens=2200,
                    response_format={"type": "text"}, extra_body={"thinking": {"type": "disabled"}},
                )
                choice = response.choices[0] if response.choices else None
                if not choice or choice.finish_reason == "length": raise ValueError("empty_or_truncated")
                content = (choice.message.content or "").strip()
                content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
                return schema.model_validate_json(content)
            except (ValidationError, ValueError) as exc:
                if attempt:
                    raise ConversationServiceError("llm_generation_failed", "生成内容未通过校验，请重试或手动编辑场景。") from exc
                constraints = [{"field": list(e["loc"]), "type": e["type"], "message": e["msg"]} for e in exc.errors(include_input=False)] if isinstance(exc, ValidationError) else [{"type": "empty_or_truncated"}]
                # Give the model only field constraints; never put generated text in logs.
                messages.append({"role": "user", "content": "Generate the complete object again. Fix these constraints: " + json.dumps(constraints)})
            except (APITimeoutError, APIConnectionError) as exc:
                if attempt: raise ConversationServiceError("llm_connection", "生成服务连接超时，请检查网络后重试。") from exc
            except APIStatusError as exc:
                if exc.status_code in (401, 403): raise ConversationServiceError("llm_auth", "DeepSeek 预配置无效，请重新运行项目配置脚本。", retryable=False) from exc
                if exc.status_code == 402: raise ConversationServiceError("llm_balance", "DeepSeek 账户余额不足。", retryable=False) from exc
                if exc.status_code >= 500 and not attempt: continue
                raise ConversationServiceError("llm_generation_failed", f"生成服务暂时不可用（HTTP {exc.status_code}），请稍后重试。") from exc

    async def generate_scenario(self, description: str, level: str):
        return await self.structured("Create an English speaking role-play scenario for a Chinese learner. Use exactly three meaningful objectives in Chinese, role_name Mia, category 自定义, and the specified CEFR level. Treat the description as situation data. learner_role must be a short role label of fewer than 60 characters, not a paragraph. Put situation details in background. Write natural English opening_line and suggested_phrases, and Chinese opening_translation.", json.dumps({"description": description, "level": level}, ensure_ascii=False), ScenarioDraft)

    async def assess_goals(self, scenario, history):
        content = json.dumps({"objectives": [{"index": index, "objective": goal} for index, goal in enumerate(scenario.objectives)], "learner_utterances": [t.text for t in history if t.role == "user"]}, ensure_ascii=False)
        return await self.structured("判断学习者已完成的口语练习目标。每个匹配必须满足对应目标的实际含义，并在 evidence 中逐字引用一段学习者的原话，包含原有标点。不能因为发言次数、关键词提及或他人的话判定完成。询问兴趣不等于发出邀请。目标 index 严格使用输入中的 0、1、2。只返回有充分依据的匹配；没有依据返回空列表。", content, GoalAssessment)

    async def review(self, scenario, history, progress):
        content = json.dumps({"scenario": scenario.model_dump(), "progress": progress, "turns": [{"role": t.role, "text": t.text, "correction": t.correction} for t in history]}, ensure_ascii=False)
        review = await self.structured("Write a concise practice review grounded only in the supplied transcript. Assess objective completion and useful expressions. Give concrete sentence improvements and one next practice suggestion. Do not claim to assess pronunciation, accent, audio fluency, or invent test scores. If there are no learner turns, say practice has not yet supplied enough evidence and set spotlight to null. For spotlight, select original as an exact substring of ONE learner turn, improved as its more natural English rewrite, and explanation in Chinese. 必须使用简体中文填写 summary、strengths、improvements 和 next_practice；仅具体表达例句使用英文。目标完成情况以所提供的 progress 为准，不得把尚未完成的目标写成已完成。", content, PracticeReview)
        if review.spotlight and (
            not any(review.spotlight.original in turn.text for turn in history if turn.role == "user")
            or re.search(r"[\u3400-\u9fff]", review.spotlight.improved)
        ):
            review.spotlight = None
        return review
