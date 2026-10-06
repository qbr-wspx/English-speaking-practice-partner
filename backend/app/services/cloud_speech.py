"""Bailian speech transport. Audio is streamed in memory and never written to disk."""
import asyncio
import base64
import io
import html
import json
import os
import re
import wave
from uuid import uuid4
import httpx
from websockets.asyncio.client import connect


class SpeechError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.provider_code = ""


def spoken_text(text):
    """Turn display punctuation into speakable English, without altering saved dialogue."""
    plain = html.unescape(text)
    plain = re.sub(r"\s*&\s*", " and ", plain)
    plain = re.sub(r"(?<=[A-Za-z])\s*/\s*(?=[A-Za-z])", " or ", plain)
    plain = re.sub(r"[•·]", ", ", plain)
    plain = re.sub(r"\s+", " ", plain)
    plain = re.sub(r"\s+,", ",", plain)
    return plain.strip()


def speech_error(code):
    lowered = str(code).lower()
    result = _speech_error(lowered)
    result.provider_code = str(code) if re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", str(code)) else "unknown"
    return result


def _speech_error(lowered):
    if any(x in lowered for x in ("auth", "apikey", "401", "403", "accessdenied")):
        return SpeechError("speech_auth", "云语音预配置无效或未开通模型，请检查北京地域账号。")
    if any(x in lowered for x in ("quota", "balance", "arrear", "402")):
        return SpeechError("speech_balance", "云语音额度或余额不足，请检查百炼账户。")
    if any(x in lowered for x in ("429", "limit", "throttl")):
        return SpeechError("speech_rate_limit", "云语音请求过于频繁，请稍后再试。")
    return SpeechError("speech_unavailable", "云语音服务暂时不可用，请检查网络与模型权限后重试。")


class CloudSpeech:
    def __init__(self):
        self.key = os.getenv("DASHSCOPE_API_KEY", "")
        self.workspace = os.getenv("DASHSCOPE_WORKSPACE_ID", "")
        self.asr_model = os.getenv("ASR_MODEL", "qwen-audio-3.1-asr-flash-streaming")
        self.tts_model = os.getenv("TTS_MODEL", "cosyvoice-v3-flash")

    @property
    def configured(self):
        return bool(self.key and self.workspace)

    @property
    def streaming_asr(self):
        return self.asr_model.endswith("-streaming") or self.asr_model.startswith("fun-asr-realtime")

    @property
    def host(self):
        if not self.configured:
            raise SpeechError("speech_not_configured", "云语音尚未完成本机预配置，当前可使用文字练习。")
        if not re.fullmatch(r"[A-Za-z0-9-]+", self.workspace):
            raise SpeechError("speech_workspace", "百炼业务空间 ID 格式无效，请检查本机配置。")
        return f"{self.workspace}.cn-beijing.maas.aliyuncs.com"

    async def socket(self):
        try:
            return await connect(f"wss://{self.host}/api-ws/v1/inference", additional_headers={"Authorization": f"Bearer {self.key}"}, open_timeout=10, close_timeout=2, max_size=4*1024*1024)
        except SpeechError: raise
        except Exception as exc:
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", None)
            # Older workspaces can still use the official Beijing shared endpoint.
            # Only routing failures qualify; authentication failures are never retried here.
            if status in (400, 404):
                try:
                    return await connect("wss://dashscope.aliyuncs.com/api-ws/v1/inference", additional_headers={"Authorization": f"Bearer {self.key}", "X-DashScope-WorkSpace": self.workspace}, open_timeout=10, close_timeout=2, max_size=4*1024*1024)
                except Exception as fallback:
                    raise speech_error(getattr(getattr(fallback, "response", None), "status_code", type(fallback).__name__)) from fallback
            raise speech_error(status or type(exc).__name__) from exc

    @staticmethod
    def command(action, task_id, payload):
        return json.dumps({"header": {"action": action, "task_id": task_id, "streaming": "duplex"}, "payload": payload})

    async def started(self, ws):
        while True:
            event = json.loads(await asyncio.wait_for(ws.recv(), 12))
            header = event.get("header", {})
            if header.get("event") == "task-failed": raise speech_error(header.get("error_code"))
            if header.get("event") == "task-started": return

    async def recognize(self, frames, partial, context=""):
        if not self.streaming_asr:
            data = bytearray()
            async for chunk in frames:
                data.extend(chunk)
            if len(data) < 3200: raise SpeechError("asr_no_speech", "没有检测到有效语音，请再说一次。")
            return await self.recognize_file(bytes(data), context)
        ws = await self.socket()
        task_id = str(uuid4())
        sender = None
        try:
            parameters = {"format": "pcm", "sample_rate": 16000, "language_hints": ["en"]}
            await ws.send(self.command("run-task", task_id, {"task_group": "audio", "task": "asr", "function": "recognition", "model": self.asr_model, "parameters": parameters, "input": {}}))
            await self.started(ws)
            async def send_frames():
                async for chunk in frames:
                    await ws.send(chunk)
                await ws.send(self.command("finish-task", task_id, {"input": {}}))
            sender = asyncio.create_task(send_frames())
            sentences = {}
            while True:
                raw = await asyncio.wait_for(ws.recv(), 35)
                if isinstance(raw, bytes): continue
                packet = json.loads(raw)
                event = packet.get("header", {}).get("event")
                if event == "task-failed": raise speech_error(packet["header"].get("error_code"))
                if event == "task-finished":
                    await sender
                    return " ".join(sentences.values()).strip()
                sentence = packet.get("payload", {}).get("output", {}).get("sentence", {})
                if sentence.get("heartbeat"): continue
                if sentence.get("text"):
                    sentences[sentence.get("sentence_id", 0)] = sentence["text"]
                    await partial(" ".join(sentences.values()))
        except asyncio.CancelledError:
            raise
        except SpeechError: raise
        except Exception as exc: raise speech_error("connection") from exc
        finally:
            if sender:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
            await ws.close()

    async def recognize_file(self, pcm, context=""):
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(pcm)
        audio = "data:audio/wav;base64," + base64.b64encode(buffer.getvalue()).decode()
        async with httpx.AsyncClient(timeout=35) as client:
            try:
                response = await client.post(f"https://{self.host}/api/v1/services/aigc/multimodal-generation/generation", headers={"Authorization": f"Bearer {self.key}", "X-DashScope-SSE": "disable"}, json={"model": self.asr_model, "input": {"messages": [{"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": audio}}]}]}, "parameters": {"format": "wav", "sample_rate": 16000}})
                if response.status_code != 200: raise speech_error(response.status_code)
                data = response.json()
                if data.get("code"): raise speech_error(data["code"])
                output = data.get("output", {})
                return output.get("text") or output.get("output", {}).get("sentence", {}).get("text", "")
            except (httpx.HTTPError, ValueError) as exc: raise speech_error("connection") from exc

    async def synthesize(self, text, voice="loongcally_v3", rate=0.95):
        if voice not in ("loongcally_v3", "loongemily_v3", "loongabby_v3", "loongannie_v3"): voice = "loongcally_v3"
        ws = await self.socket()
        task_id = str(uuid4())
        try:
            await ws.send(self.command("run-task", task_id, {"task_group": "audio", "task": "tts", "function": "SpeechSynthesizer", "model": self.tts_model, "input": {}, "parameters": {"text_type": "PlainText", "voice": voice, "format": "pcm", "sample_rate": 24000, "rate": max(0.7, min(1.3, rate)), "language_hints": ["en"]}}))
            await self.started(ws)
            await ws.send(self.command("continue-task", task_id, {"input": {"text": spoken_text(text)}}))
            await ws.send(self.command("finish-task", task_id, {"input": {}}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), 25)
                if isinstance(raw, bytes):
                    yield raw
                    continue
                packet = json.loads(raw)
                event = packet.get("header", {}).get("event")
                if event == "task-failed": raise speech_error(packet["header"].get("error_code"))
                if event == "task-finished": return
        except asyncio.CancelledError:
            try: await ws.send(self.command("finish-task", task_id, {"input": {"directive": "cancel"}}))
            except Exception: pass
            raise
        except SpeechError: raise
        except Exception as exc: raise speech_error("connection") from exc
        finally:
            await ws.close()
