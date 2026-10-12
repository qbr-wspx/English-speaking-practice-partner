import asyncio
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app import database as db
from app.application import create_app
from app.scenarios import load_scenario, ScenarioDraft
from app.services.llm import AssistantReply, GoalMatch, PracticeReview, ConversationServiceError


class FakeSpeech:
    configured = True
    streaming_asr = True
    asr_model = "qwen-audio-3.1-asr-flash-streaming"
    text = "I have a reservation under Chen."
    cancelled = False
    async def recognize(self, frames, partial, context=""):
        async for frame in frames:
            assert isinstance(frame, bytes)
            await partial("I have a reservation")
        return self.text
    async def synthesize(self, text, voice, rate):
        yield bytes(2400)


class FakeLLM:
    configured = True
    scenarios = []
    calls = 0
    reviews = 0
    async def reply(self, scenario, history):
        self.scenarios.append(scenario.model_copy(deep=True))
        self.calls += 1
        return AssistantReply(reply_en="Thank you. May I see your passport?", translation_zh="谢谢，可以看看你的护照吗？", goal_matches=[GoalMatch(index=0, evidence=history[-1].text), GoalMatch(index=1, evidence="invented evidence")])
    async def generate_scenario(self, description, level):
        item = load_scenario("hotel-checkin").model_dump()
        item["level"] = level
        return ScenarioDraft.model_validate(item)
    async def review(self, scenario, history, progress):
        self.reviews += 1
        return PracticeReview(summary="完成了预订信息表达。", strengths=["说明了姓名"], improvements=["可以使用完整句子"], next_practice="再练习询问早餐。")


@pytest.fixture
def services(tmp_path):
    engine = db.create_database_engine(f"sqlite:///{(tmp_path/'test.db').as_posix()}")
    llm, speech = FakeLLM(), FakeSpeech()
    llm.scenarios = []
    return engine, llm, speech


def client_for(services, **kwargs):
    engine, llm, speech = services
    kwargs.setdefault("token", "")
    return TestClient(create_app(engine=engine, llm_service=llm, speech_service=speech, **kwargs))


def until(ws, kind):
    for _ in range(30):
        event = ws.receive_json()
        if event["type"] == kind: return event
    raise AssertionError(f"Did not receive {kind}")


def start(ws, scenario="hotel-checkin"):
    ws.send_json({"type": "session.start", "scenario_id": scenario, "level": "B1"})
    ready = until(ws, "session.ready")
    until(ws, "assistant.audio.end")
    return ready


def test_eight_scenarios_and_invalid_identifier(services):
    with client_for(services) as client:
        scenes = client.get("/api/scenarios").json()
        assert len(scenes) == 8
        assert all(len(s["objectives"]) == 3 for s in scenes)
        assert client.get("/api/scenarios/unknown").status_code == 404
    with pytest.raises(KeyError): load_scenario("../../models")


def test_cached_client_playback_cancel_echoes_requested_turn(services):
    with client_for(services) as client, client.websocket_connect("/ws/conversation") as ws:
        start(ws)
        ws.send_json({"type": "turn.cancel", "turn_id": "local-replay"})
        assert until(ws, "turn.cancelled")["turn_id"] == "local-replay"
        ws.send_json({"type": "text.submit", "turn_id": "after-replay", "text": "Hello."})
        assert until(ws, "assistant.final")["turn_id"] == "after-replay"


def test_discard_during_reply_deletes_session_and_turns(services):
    with client_for(services) as client, client.websocket_connect("/ws/conversation") as ws:
        ready = start(ws)
        session_id = ready["session_id"]
        ws.send_json({"type": "text.submit", "turn_id": "discarded-turn", "text": "I have a reservation under Chen."})
        until(ws, "assistant.audio.end")
        assert len(client.get(f"/api/sessions/{session_id}").json()["turns"]) == 3
        ws.send_json({"type": "session.discard"})
        assert until(ws, "session.discarded")["session_id"] == session_id
        assert client.get(f"/api/sessions/{session_id}").status_code == 404
        assert all(row["id"] != session_id for row in client.get("/api/sessions").json())


def test_selected_scenario_progress_evidence_and_idempotent_retry(services):
    with client_for(services) as client, client.websocket_connect("/ws/conversation") as ws:
        ready = start(ws)
        request = {"type": "text.submit", "turn_id": "same-request", "text": "I have a reservation under Chen."}
        ws.send_json(request)
        until(ws, "assistant.final")
        progress = until(ws, "goals.updated")["progress"]
        assert progress[0]["completed"] and not progress[1]["completed"]
        assert progress[0]["turn_id"]
        until(ws, "assistant.audio.end")
        ws.send_json(request)
        until(ws, "assistant.final"); until(ws, "assistant.audio.end")
        saved = client.get(f"/api/sessions/{ready['session_id']}").json()
        assert len(saved["turns"]) == 3
        assert services[1].calls == 1
        assert services[1].scenarios[0].id == "hotel-checkin"
        assert services[1].scenarios[0].level == "B1"


def test_custom_crud_snapshot_and_review_survive_deletion(services):
    with client_for(services) as client:
        draft = client.post("/api/scenarios/generate", json={"description": "酒店入住练习", "level": "B2"}).json()
        created = client.post("/api/scenarios", json=draft)
        assert created.status_code == 201
        scene = created.json()
        with client.websocket_connect("/ws/conversation") as ws:
            ready = start(ws, scene["id"])
            draft["title_zh"] = "修改后的场景"
            assert client.put(f"/api/scenarios/{scene['id']}", json=draft).status_code == 200
            assert client.delete(f"/api/scenarios/{scene['id']}").status_code == 200
            ws.send_json({"type": "text.submit", "turn_id": "t", "text": "My name is Chen."})
            until(ws, "assistant.audio.end")
            ws.send_json({"type": "session.stop"}); until(ws, "session.ended")
        sid = ready["session_id"]
        saved = client.get(f"/api/sessions/{sid}").json()
        assert saved["scenario"]["title_zh"] == scene["title_zh"]
        assert services[1].scenarios[0].title_zh == scene["title_zh"]
        assert client.post(f"/api/sessions/{sid}/review").status_code == 200
        assert client.post(f"/api/sessions/{sid}/review").status_code == 200
        assert services[1].reviews == 1
        assert client.delete(f"/api/sessions/{sid}").status_code == 200
        assert client.get(f"/api/sessions/{sid}").status_code == 404


def test_streaming_audio_and_empty_transcript(services):
    with client_for(services) as client, client.websocket_connect("/ws/conversation") as ws:
        start(ws)
        ws.send_json({"type": "audio.start", "turn_id": "audio-1", "sample_rate": 16000})
        ws.send_bytes(bytes(3200))
        assert until(ws, "transcript.partial")["turn_id"] == "audio-1"
        ws.send_json({"type": "audio.end"})
        assert until(ws, "transcript.final")["text"] == services[2].text
        until(ws, "assistant.audio.end")
        services[2].text = ""
        ws.send_json({"type": "audio.start", "turn_id": "audio-2"})
        ws.send_json({"type": "audio.end"})
        assert until(ws, "error")["code"] == "asr_no_speech"
        assert services[1].calls == 1


def test_cancel_interrupts_llm_and_accepts_new_turn(services):
    class SlowLLM(FakeLLM):
        async def reply(self, scenario, history):
            if history[-1].text == "slow":
                await asyncio.sleep(100)
            return await super().reply(scenario, history)
    engine, _, speech = services
    llm = SlowLLM(); llm.scenarios = []
    with TestClient(create_app(engine, llm_service=llm, speech_service=speech, token="")) as client, client.websocket_connect("/ws/conversation") as ws:
        ready = start(ws)
        ws.send_json({"type": "text.submit", "turn_id": "old", "text": "slow"})
        until(ws, "assistant.processing")
        ws.send_json({"type": "turn.cancel"})
        until(ws, "turn.cancelled")
        ws.send_json({"type": "text.submit", "turn_id": "new", "text": "I have a reservation."})
        assert until(ws, "assistant.final")["turn_id"] == "new"
        until(ws, "assistant.audio.end")
        saved = client.get(f"/api/sessions/{ready['session_id']}").json()
        assert not any(t["role"] == "assistant" and t["request_id"] == "old" for t in saved["turns"])


def test_tts_failure_preserves_reply_and_recovers(services):
    from app.services.cloud_speech import SpeechError
    class BrokenSpeech(FakeSpeech):
        async def synthesize(self, *args):
            raise SpeechError("speech_balance", "余额不足")
            yield b""
    engine, llm, _ = services
    with TestClient(create_app(engine, llm_service=llm, speech_service=BrokenSpeech(), token="")) as client, client.websocket_connect("/ws/conversation") as ws:
        ws.send_json({"type": "session.start"})
        until(ws, "session.ready"); until(ws, "error")
        ws.send_json({"type": "text.submit", "turn_id": "t", "text": "Coffee please."})
        until(ws, "assistant.final")
        error = until(ws, "error")
        assert error["stage"] == "tts"


def test_auth_and_active_session_deletion(services):
    with client_for(services, token="test-token") as client:
        assert client.get("/api/scenarios").status_code == 401
        assert client.get("/api/scenarios", headers={"Authorization": "Bearer test-token"}).status_code == 200
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/conversation?token=wrong"): pass
        with client.websocket_connect("/ws/conversation?token=test-token") as ws:
            ready = start(ws)
            assert client.delete(f"/api/sessions/{ready['session_id']}", headers={"Authorization": "Bearer test-token"}).status_code == 409


def test_legacy_database_migration_backup_and_interruption(tmp_path):
    file = tmp_path / "legacy.db"
    with sqlite3.connect(file) as connection:
        connection.executescript("CREATE TABLE conversationsession (id TEXT PRIMARY KEY, scenario_id TEXT, started_at DATETIME, ended_at DATETIME); CREATE TABLE turn (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, text TEXT, translation TEXT, correction TEXT, suggested_phrase TEXT, created_at DATETIME); INSERT INTO conversationsession VALUES ('old','cafe-ordering','2026-09-29 10:00:00',NULL);")
    engine = db.create_database_engine(f"sqlite:///{file.as_posix()}")
    db.init_database(engine)
    assert file.with_suffix(".pre-v2.db").exists()
    saved = db.get_conversation(engine, "old")
    assert saved["status"] == "interrupted" and saved["ended_at"]
    db.init_database(engine)
    assert len(db.list_conversations(engine)) == 1
