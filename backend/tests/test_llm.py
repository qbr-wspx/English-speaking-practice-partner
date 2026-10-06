import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI

from app.models import Turn
from app.scenarios import load_scenario
from app.services.llm import (
    ConversationServiceError,
    DeepSeekService,
    ReplyFormatError,
    dialogue_history,
    parse_assistant_reply,
)


def completion(content, finish_reason="stop"):
    return {
        "id": "test-completion", "object": "chat.completion", "created": 0,
        "model": "deepseek-v4-flash",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": finish_reason}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70},
    }


def run_with_responses(responses, *, history=None):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        status, body = responses[len(requests) - 1]
        return httpx.Response(status, json=body)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = AsyncOpenAI(api_key="test-placeholder", base_url="https://example.invalid", http_client=http, max_retries=0)
            service = DeepSeekService()
            service.client = client
            reply = await service.reply(load_scenario(), history or [
                Turn(session_id="test", role="assistant", text="For here or to go?"),
                Turn(session_id="test", role="user", text="I want a two-goal cap."),
            ])
            return reply

    return asyncio.run(run()), requests


@pytest.mark.parametrize("content", ["", "   ", "{}", '{"reply_en":" "}', '{"reply_en":null}',
                                            '{"reply_en":"truncated', '```json\n{"wrong":1}\n```',
                                            '[]', 'null', '"Hello"'])
def test_invalid_structured_answers_are_never_spoken(content):
    with pytest.raises(ReplyFormatError):
        parse_assistant_reply(content)


def test_optional_null_fields_do_not_erase_a_valid_reply():
    reply = parse_assistant_reply('{"reply_en":"Did you mean a to-go cup?","correction":null}')
    assert reply.reply_en == "Did you mean a to-go cup?"
    assert reply.correction == ""


def test_awkward_input_is_sent_verbatim_without_json_mode():
    body = '{"reply_en":"Did you mean a to-go cup?","translation_zh":"你是想要外带杯吗？","correction":""}'
    reply, requests = run_with_responses([(200, completion(body))])
    assert reply.translation_zh == "你是想要外带杯吗？"
    assert len(requests) == 1
    assert requests[0]["model"] == "deepseek-v4-flash"
    assert requests[0]["thinking"] == {"type": "disabled"}
    assert requests[0]["response_format"] == {"type": "text"}
    assert requests[0]["messages"][-1]["content"] == "I want a two-goal cap."
    assert requests[0]["messages"][-2]["content"] == "For here or to go?"


@pytest.mark.parametrize("first", [completion(None), completion("   "), completion('{"wrong":"schema"}'),
                                   completion('{"reply_en":"cut off', "length"),
                                   {"id": "empty", "object": "chat.completion", "created": 0, "model": "test", "choices": []}])
def test_empty_or_broken_response_changes_strategy_and_recovers(first):
    reply, requests = run_with_responses([
        (200, first), (200, completion("Did you mean a to-go cup?")),
    ])
    assert reply.reply_en == "Did you mean a to-go cup?"
    assert reply.translation_zh == ""  # Do not fabricate a translation in fallback mode.
    assert len(requests) == 2
    assert requests[0]["messages"][0] != requests[1]["messages"][0]
    assert requests[1]["messages"][-2]["content"] == "For here or to go?"
    assert requests[1]["messages"][-1]["content"] == "I want a two-goal cap."


def test_two_empty_responses_produce_actionable_service_error():
    with pytest.raises(ConversationServiceError) as caught:
        run_with_responses([(200, completion("")), (200, completion(""))])
    assert caught.value.code == "llm_empty_reply"
    assert "英语" in str(caught.value)


@pytest.mark.parametrize("status,code", [(401, "llm_auth"), (402, "llm_balance"), (429, "llm_rate_limit")])
def test_credentials_balance_and_rate_limit_are_not_misreported_as_empty(status, code):
    with pytest.raises(ConversationServiceError) as caught:
        run_with_responses([(status, {"error": {"message": "sensitive upstream details"}})])
    assert caught.value.code == code
    assert "sensitive" not in str(caught.value)


def test_failed_user_retries_do_not_compete_with_latest_input():
    turns = [
        Turn(session_id="s", role="assistant", text="For here or to go?"),
        Turn(session_id="s", role="user", text="I want a two-goal cap."),
        Turn(session_id="s", role="user", text="I want a 2 gold cap."),
        Turn(session_id="s", role="user", text="To go, please."),
    ]
    messages = dialogue_history(turns, structured=False)
    assert [m["content"] for m in messages] == ["For here or to go?", "To go, please."]
    assert len(turns) == 4  # Persisted history is untouched.


def test_generated_scene_retries_field_constraints_without_uploading_bad_output():
    from app.scenarios import ScenarioDraft
    scene = load_scenario("hotel-checkin").model_dump()
    invalid = {**scene, "learner_role": "X" * 101}
    requests = []
    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=completion(json.dumps(invalid if len(requests) == 1 else scene)))
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            service = DeepSeekService()
            service.client = AsyncOpenAI(api_key="test", base_url="https://example.invalid", http_client=http, max_retries=0)
            return await service.generate_scenario("hotel", "A2")
    result = asyncio.run(run())
    assert isinstance(result, ScenarioDraft) and result.learner_role == "Guest"
    assert len(requests) == 2
    assert "learner_role" in requests[-1]["messages"][-1]["content"]
    assert "X" * 101 not in requests[-1]["messages"][-1]["content"]


@pytest.mark.parametrize("text", ["你好", "你好 hello", "```english Hello```", "<analysis>Hello</analysis>"])
def test_non_spoken_content_is_never_sent_to_tts(text):
    with pytest.raises((ReplyFormatError, ValueError)):
        parse_assistant_reply(json.dumps({"reply_en": text}))


def test_review_spotlight_requires_a_real_learner_quote():
    from app.services.llm import PracticeReview
    turns = [Turn(session_id="s", role="user", text="I want a coffee please.")]
    service = DeepSeekService()
    async def structured(_prompt, _content, _schema):
        return PracticeReview(
            summary="说出了需求。", strengths=[], improvements=[], next_practice="再练习一次。",
            spotlight={"original": "I want a tea please.", "improved": "Could I have a tea, please?", "explanation": "更礼貌。"},
        )
    service.structured = structured
    result = asyncio.run(service.review(load_scenario(), turns, []))
    assert result.spotlight is None
