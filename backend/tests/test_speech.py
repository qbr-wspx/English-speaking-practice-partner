import asyncio
import json
import pytest
from app.services.cloud_speech import CloudSpeech, SpeechError, speech_error


class FakeSocket:
    def __init__(self, tts=False):
        self.events = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.tts = tts
    async def send(self, data):
        self.sent.append(data)
        if isinstance(data, bytes):
            await self.events.put(json.dumps({"header": {"event": "result-generated"}, "payload": {"output": {"sentence": {"sentence_id": 1, "text": "A coffee please.", "sentence_end": False}}}}))
        else:
            packet = json.loads(data)
            action = packet["header"]["action"]
            if action == "run-task": await self.events.put(json.dumps({"header": {"event": "task-started"}}))
            if action == "continue-task" and self.tts: await self.events.put(bytes(4800))
            if action == "finish-task": await self.events.put(json.dumps({"header": {"event": "task-finished"}}))
    async def recv(self): return await self.events.get()
    async def close(self): self.closed = True


def test_qwen_streaming_sends_pcm_and_forwards_partial(monkeypatch):
    monkeypatch.setenv("ASR_MODEL", "qwen-audio-3.1-asr-flash-streaming")
    service = CloudSpeech(); ws = FakeSocket(); partials = []
    async def socket(): return ws
    service.socket = socket
    async def frames(): yield bytes(3200)
    async def partial(text): partials.append(text)
    result = asyncio.run(service.recognize(frames(), partial))
    assert result == "A coffee please." and partials == [result]
    request = json.loads(ws.sent[0])
    assert request["payload"]["model"] == "qwen-audio-3.1-asr-flash-streaming"
    assert request["payload"]["parameters"]["language_hints"] == ["en"]
    assert ws.closed


def test_tts_streams_pcm_english_and_closes(monkeypatch):
    service = CloudSpeech(); ws = FakeSocket(tts=True)
    async def socket(): return ws
    service.socket = socket
    async def run(): return [chunk async for chunk in service.synthesize("Hello!", "loongemily_v3", 0.9)]
    assert asyncio.run(run()) == [bytes(4800)]
    packets = [json.loads(p) for p in ws.sent if isinstance(p, str)]
    assert len({p["header"]["task_id"] for p in packets}) == 1
    params = packets[0]["payload"]["parameters"]
    assert params["voice"] == "loongemily_v3" and params["format"] == "pcm" and params["sample_rate"] == 24000
    assert ws.closed


@pytest.mark.parametrize("code,expected", [("401", "speech_auth"), ("QuotaExceeded", "speech_balance"), ("429", "speech_rate_limit"), ("network", "speech_unavailable")])
def test_speech_errors_are_actionable_without_upstream_details(code, expected):
    assert speech_error(code).code == expected


def test_missing_config_never_connects(monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("DASHSCOPE_WORKSPACE_ID", raising=False)
    service = CloudSpeech()
    with pytest.raises(SpeechError) as caught: _ = service.host
    assert caught.value.code == "speech_not_configured"

def test_ampersand_is_spoken_as_and_without_changing_other_words():
    from app.services.cloud_speech import spoken_text
    assert spoken_text('Welcome to Brew & Bloom!') == 'Welcome to Brew and Bloom!'
    assert spoken_text('Coffee &amp; tea, please.') == 'Coffee and tea, please.'
    assert spoken_text('AT&T') == 'AT and T'
    assert spoken_text("I'd like a latte, please.") == "I'd like a latte, please."
    assert spoken_text("Coffee / tea • water") == "Coffee or tea, water"
