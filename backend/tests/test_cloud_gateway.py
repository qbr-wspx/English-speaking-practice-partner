import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.application import create_app
from app.cloud_gateway import CloudGateway, Registry
from tests.test_backend import FakeLLM, FakeSpeech


def gateway_for(tmp_path):
    registry = Registry(tmp_path)
    llm, speech = FakeLLM(), FakeSpeech()
    gateway = CloudGateway(registry=registry, app_factory=lambda **kwargs: create_app(llm_service=llm, speech_service=speech, **kwargs))
    return gateway, registry


def redeem(client, code):
    response = client.post("/v1/invite/redeem", json={"code": code})
    assert response.status_code == 200
    return response.json()["token"]


def test_one_time_invite_isolated_histories_and_revoke(tmp_path):
    gateway, registry = gateway_for(tmp_path)
    with TestClient(gateway) as client:
        first_code, second_code = registry.create_invitation(), registry.create_invitation()
        first, second = redeem(client, first_code), redeem(client, second_code)
        assert client.post("/v1/invite/redeem", json={"code": first_code}).status_code == 403
        assert first != second
        assert client.get("/api/sessions").status_code == 401
        first_headers, second_headers = {"Authorization": f"Bearer {first}"}, {"Authorization": f"Bearer {second}"}
        with client.websocket_connect("/ws/conversation?ticket=" + client.post("/v1/ws-ticket", headers=first_headers).json()["ticket"]) as ws:
            ws.send_json({"type": "session.start", "scenario_id": "hotel-checkin", "level": "A2"})
            assert ws.receive_json()["type"] == "session.ready"
            ws.send_json({"type": "session.stop"})
        assert len(client.get("/api/sessions", headers=first_headers).json()) == 1
        assert client.get("/api/sessions", headers=second_headers).json() == []
        assert registry.revoke(first)
        assert client.get("/api/sessions", headers=first_headers).status_code == 401
        assert client.get("/api/sessions", headers=second_headers).status_code == 200


def test_ticket_is_single_use_and_quota_blocks_paid_calls(tmp_path):
    gateway, registry = gateway_for(tmp_path)
    gateway.limits["session"] = (1, 1)
    with TestClient(gateway) as client:
        token = redeem(client, registry.create_invitation())
        headers = {"Authorization": f"Bearer {token}"}
        ticket = client.post("/v1/ws-ticket", headers=headers).json()["ticket"]
        with client.websocket_connect("/ws/conversation?ticket=" + ticket) as ws:
            ws.send_json({"type": "session.start", "scenario_id": "cafe-ordering"})
            assert ws.receive_json()["type"] == "session.ready"
            ws.send_json({"type": "session.stop"})
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws/conversation?ticket=" + ticket):
                pass
        second_ticket = client.post("/v1/ws-ticket", headers=headers).json()["ticket"]
        with client.websocket_connect("/ws/conversation?ticket=" + second_ticket) as ws:
            ws.send_json({"type": "session.start", "scenario_id": "cafe-ordering"})
            event = ws.receive_json()
            assert event["type"] == "error" and event["stage"] == "quota"
        assert registry.identify(token)


def test_invite_bruteforce_limit_and_expiry(tmp_path):
    gateway, registry = gateway_for(tmp_path)
    with TestClient(gateway) as client:
        for _ in range(8):
            assert client.post("/v1/invite/redeem", json={"code": "wrong"}).status_code == 403
        assert client.post("/v1/invite/redeem", json={"code": registry.create_invitation()}).status_code == 429
