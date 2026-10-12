import asyncio
import base64
import json
import os
import secrets
import hashlib
from typing import Literal
from uuid import uuid4
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from . import database as db
from .scenarios import Scenario, ScenarioDraft, build_scenario, list_scenarios, load_scenario
from .services.cloud_speech import CloudSpeech, SpeechError
from .services.llm import DeepSeekService, ConversationServiceError


class GenerateRequest(BaseModel):
    description: str = Field(min_length=3, max_length=2000)
    level: Literal["A1", "A2", "B1", "B2"] = "A2"


def create_app(engine=None, asr_service=None, llm_service=None, speech_service=None, token=None):
    database = engine or db.create_database_engine()
    db.init_database(database)
    llm = llm_service or DeepSeekService()
    speech = speech_service or CloudSpeech()
    auth_token = token if token is not None else os.getenv("LINGO_BACKEND_TOKEN") or secrets.token_hex(32)
    active_sessions = set()
    app = FastAPI(title="Lingo Studio API", version=os.getenv("LINGO_APP_VERSION", "0.2.13"))
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "null"], allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type", "Authorization"])

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        if request.url.path != "/health" and request.method != "OPTIONS" and auth_token and not secrets.compare_digest(request.headers.get("Authorization", ""), f"Bearer {auth_token}"):
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        return await call_next(request)

    @app.exception_handler(ConversationServiceError)
    async def service_error(_request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={"detail": str(exc), "code": exc.code})

    def find_scenario(identifier):
        try: return load_scenario(identifier)
        except KeyError:
            for item in db.custom_scenarios(database):
                if item["id"] == identifier: return Scenario.model_validate(item)
        raise HTTPException(status_code=404, detail="场景不存在，可能已被删除。")

    @app.get("/health")
    def health():
        return {"status": "ok", "version": app.version, "instance_id": hashlib.sha256(auth_token.encode()).hexdigest()[:16], "deepseek_configured": llm.configured, "speech_configured": speech.configured, "asr_model": speech.asr_model, "streaming_asr": speech.streaming_asr, "database": "ready"}

    @app.get("/api/scenarios")
    def scenarios(): return list_scenarios() + db.custom_scenarios(database)

    @app.post("/api/scenarios/generate")
    async def generate(body: GenerateRequest):
        return await llm.generate_scenario(body.description, body.level)

    @app.get("/api/scenarios/{identifier}")
    def scenario_detail(identifier: str): return find_scenario(identifier)

    @app.post("/api/scenarios", status_code=201)
    def save_scenario(body: ScenarioDraft):
        item = build_scenario("custom-" + str(uuid4()), body)
        db.save_custom(database, item)
        return item

    @app.put("/api/scenarios/{identifier}")
    def edit_scenario(identifier: str, body: ScenarioDraft):
        if find_scenario(identifier).source != "custom": raise HTTPException(403, "内置场景请先复制再编辑。")
        item = build_scenario(identifier, body)
        db.save_custom(database, item)
        return item

    @app.delete("/api/scenarios/{identifier}")
    def remove_scenario(identifier: str):
        if not db.delete_custom(database, identifier): raise HTTPException(404, "自定义场景不存在。")
        return {"deleted": True}

    @app.get("/api/sessions")
    def sessions(): return db.list_conversations(database)

    @app.get("/api/sessions/{identifier}")
    def session_detail(identifier: str):
        item = db.get_conversation(database, identifier)
        if not item: raise HTTPException(404, "会话不存在。")
        return item

    @app.delete("/api/sessions/{identifier}")
    def remove_session(identifier: str):
        if identifier in active_sessions: raise HTTPException(409, "请先结束正在进行的练习。")
        if not db.delete_conversation(database, identifier): raise HTTPException(404, "会话不存在。")
        return {"deleted": True}

    @app.post("/api/sessions/{identifier}/review")
    async def review(identifier: str):
        item = session_detail(identifier)
        if item["review"]: return item["review"]
        if identifier in active_sessions: raise HTTPException(409, "请先结束练习。")
        scenario = Scenario.model_validate(item["scenario"]) if item["scenario"] else find_scenario(item["scenario_id"])
        result = await llm.review(scenario, db.get_turns(database, identifier), item["progress"])
        db.update_conversation(database, identifier, review_json=result.model_dump_json())
        return result

    @app.websocket("/ws/conversation")
    async def conversation(websocket: WebSocket):
        if auth_token and not secrets.compare_digest(websocket.query_params.get("token", ""), auth_token):
            await websocket.close(code=1008); return
        await websocket.accept()
        session_id = None
        scenario = None
        worker = None
        queue = None
        turn_id = ""
        options = {}
        audio_bytes = 0
        progress = []
        send_lock = asyncio.Lock()

        async def send(kind, request_id=None, **payload):
            async with send_lock:
                await websocket.send_json({"type": kind, "session_id": session_id, "turn_id": request_id or turn_id, **payload})

        async def cancel():
            nonlocal worker, queue
            if worker:
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)
                worker = None
            queue = None

        async def report_error(stage, exc, identifier):
            await send("error", identifier, stage=stage, code=getattr(exc, "code", stage + "_failed"), retryable=True, message=str(exc) if isinstance(exc, (SpeechError, ConversationServiceError)) else "这轮未能完成，请重试或改用文字。")

        async def speak(text, identifier):
            try:
                await send("assistant.audio.start", identifier, sample_rate=24000)
                received = False
                async for chunk in speech.synthesize(text, options.get("voice", "loongcally_v3"), float(options.get("rate", 0.95))):
                    received = True
                    # JSON framing binds every audio chunk to a turn, including delayed chunks after cancellation.
                    await send("assistant.audio.chunk", identifier, audio=base64.b64encode(chunk).decode())
                if not received: raise SpeechError("tts_empty", "这轮没有收到语音，仍可继续文字练习。")
                await send("assistant.audio.end", identifier)
            except asyncio.CancelledError: raise
            except Exception as exc: await report_error("tts", exc, identifier)

        async def process_text(text, identifier):
            nonlocal progress
            cleaned = text.strip()
            if not cleaned:
                await report_error("asr", SpeechError("asr_no_speech", "没有听清，请再说一次或用文字输入。"), identifier); return
            if len(cleaned) > 4000:
                await report_error("llm", ConversationServiceError("text_too_long", "请缩短本次输入。"), identifier); return
            previous = db.get_turns(database, session_id)
            cached = next((t for t in previous if t.role == "assistant" and t.request_id == identifier), None)
            if cached:
                await send("assistant.final", identifier, message_id=cached.id, reply_en=cached.text, translation_zh=cached.translation, correction=cached.correction, suggested_phrase=cached.suggested_phrase)
                await speak(cached.text, identifier); return
            user = db.add_turn(database, session_id, "user", cleaned, request_id=identifier)
            await send("transcript.final", identifier, text=user.text, message_id=user.id)
            await send("assistant.processing", identifier)
            try:
                history = db.get_turns(database, session_id)
                reply = await llm.reply(scenario, history)
                if "goal_matches" not in reply.model_fields_set and hasattr(llm, "assess_goals"):
                    # Some providers omit optional metadata while returning valid dialogue.
                    # Assess the learner's exact words separately rather than invent progress.
                    try: reply.goal_matches = (await llm.assess_goals(scenario, history)).goal_matches
                    except ConversationServiceError: pass
                for match in reply.goal_matches:
                    evidence_turn = next((t for t in history if t.role == "user" and match.evidence in t.text), None)
                    if evidence_turn and match.index < len(progress) and not progress[match.index]["completed"]:
                        progress[match.index].update(completed=True, evidence=match.evidence, turn_id=evidence_turn.id)
                db.update_conversation(database, session_id, progress_json=json.dumps(progress, ensure_ascii=False))
                assistant = db.add_turn(database, session_id, "assistant", reply.reply_en, reply.translation_zh, reply.correction, reply.suggested_phrase, request_id=identifier)
                await send("assistant.final", identifier, message_id=assistant.id, **reply.model_dump())
                await send("goals.updated", identifier, progress=progress)
                await speak(reply.reply_en, identifier)
            except asyncio.CancelledError: raise
            except Exception as exc: await report_error("llm", exc, identifier)

        async def process_audio(frames_queue, identifier):
            async def frames():
                while True:
                    chunk = await frames_queue.get()
                    if chunk is None: return
                    yield chunk
            async def partial(text): await send("transcript.partial", identifier, text=text)
            try:
                text = await speech.recognize(frames(), partial, scenario.background)
                await process_text(text, identifier)
            except asyncio.CancelledError: raise
            except Exception as exc: await report_error("asr", exc, identifier)

        try:
            while True:
                packet = await websocket.receive()
                if packet["type"] == "websocket.disconnect": break
                if packet.get("bytes") is not None:
                    if queue:
                        chunk = packet["bytes"]
                        audio_bytes += len(chunk)
                        if len(chunk) % 2 or audio_bytes > 16000*2*120:
                            await cancel()
                            await report_error("asr", SpeechError("audio_limit", "录音格式无效或超过两分钟，请分段练习。"), turn_id)
                        else:
                            try: queue.put_nowait(chunk)
                            except asyncio.QueueFull:
                                await cancel()
                                await report_error("asr", SpeechError("audio_overflow", "网络传输过慢，请重新录音。"), turn_id)
                    continue
                try: event = json.loads(packet.get("text") or "{}")
                except json.JSONDecodeError:
                    await send("error", code="invalid_event", message="无效的对话请求。", stage="protocol"); continue
                if not isinstance(event, dict): continue
                kind = event.get("type")
                if kind == "session.start":
                    if session_id: continue
                    try:
                        scenario = find_scenario(str(event.get("scenario_id", "cafe-ordering"))).model_copy(deep=True)
                        if event.get("level") in ("A1", "A2", "B1", "B2"): scenario.level = event["level"]
                    except HTTPException as exc:
                        await send("error", code="scenario_missing", message=exc.detail, stage="scenario"); continue
                    options = event.get("options") if isinstance(event.get("options"), dict) else {}
                    session_id = db.create_conversation(database, scenario.id, scenario.model_dump_json()).id
                    active_sessions.add(session_id)
                    turn_id = str(uuid4())
                    progress = [{"objective": goal, "completed": False, "evidence": "", "turn_id": ""} for goal in scenario.objectives]
                    db.update_conversation(database, session_id, progress_json=json.dumps(progress, ensure_ascii=False))
                    opening = db.add_turn(database, session_id, "assistant", scenario.opening_line, scenario.opening_translation, suggested_phrase=scenario.suggested_phrases[0] if scenario.suggested_phrases else "", request_id=turn_id)
                    await send("session.ready", turn_id, opening_line=opening.text, opening_translation=opening.translation, suggested_phrase=opening.suggested_phrase, message_id=opening.id, scenario=scenario.model_dump(), progress=progress)
                    worker = asyncio.create_task(speak(opening.text, turn_id))
                elif kind == "session.discard":
                    await cancel()
                    if session_id:
                        db.delete_conversation(database, session_id)
                        active_sessions.discard(session_id)
                    await send("session.discarded")
                    await websocket.close(code=1000); return
                elif kind == "session.stop" and session_id:
                    await cancel()
                    db.end_conversation(database, session_id)
                    active_sessions.discard(session_id)
                    await send("session.ended")
                    await websocket.close(code=1000); return
                elif kind == "turn.cancel" and session_id:
                    await cancel()
                    # Cached local playback can have a client ID unknown to the server.
                    await send("turn.cancelled", str(event.get("turn_id") or turn_id)[:100])
                elif kind == "playback.complete":
                    pass
                elif kind in ("text.submit", "audio.start", "assistant.replay") and session_id:
                    if worker and not worker.done():
                        await send("error", stage="protocol", code="turn_busy", message="请等待这轮完成，或先点击打断。", retryable=True); continue
                    queue = None
                    turn_id = str(event.get("turn_id") or uuid4())[:100]
                    if kind == "text.submit": worker = asyncio.create_task(process_text(str(event.get("text", "")), turn_id))
                    elif kind == "assistant.replay":
                        item = next((t for t in db.get_turns(database, session_id) if t.id == event.get("message_id") and t.role == "assistant"), None)
                        if item: worker = asyncio.create_task(speak(item.text, turn_id))
                        else: await send("error", stage="tts", code="message_missing", message="未找到这条回复。")
                    else:
                        if event.get("sample_rate", 16000) != 16000:
                            await report_error("asr", SpeechError("audio_format", "仅支持 16 kHz 单声道录音。"), turn_id); continue
                        audio_bytes = 0
                        queue = asyncio.Queue(maxsize=256)
                        worker = asyncio.create_task(process_audio(queue, turn_id))
                elif kind == "audio.end" and queue:
                    await queue.put(None)
                    queue = None
                    await send("assistant.transcribing")
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await cancel()
            if session_id in active_sessions:
                active_sessions.discard(session_id)
                db.end_conversation(database, session_id, "interrupted")
    return app
