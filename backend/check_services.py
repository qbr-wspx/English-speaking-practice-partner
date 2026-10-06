"""Synthetic live check; never prints keys or existing conversations."""
import asyncio
import json
import time
import wave
from pathlib import Path
from app.models import Turn
from app.scenarios import load_scenario
from app.services.llm import DeepSeekService
from app.services.cloud_speech import CloudSpeech


async def main():
    llm, speech = DeepSeekService(), CloudSpeech()
    failed = 0
    audio = bytearray()
    try:
        for name in ("DeepSeek", "TTS", "ASR"):
            started = time.monotonic()
            try:
                if name == "DeepSeek":
                    await llm.reply(load_scenario(), [Turn(session_id="check", role="user", text="A small coffee, please.")])
                elif name == "TTS":
                    audio = bytearray()
                    async for chunk in speech.synthesize("Hello! Welcome to your English practice. How has your day been?"):
                        audio.extend(chunk)
                    if not audio: raise ValueError("empty_audio")
                    directory = Path(__file__).parents[1] / ".cache"
                    directory.mkdir(exist_ok=True)
                    with wave.open(str(directory / "voice-preview.wav"), "wb") as output:
                        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000); output.writeframes(audio)
                else:
                    if not audio: raise ValueError("tts_required_for_synthetic_asr_check")
                    # Resample synthetic speech to the ASR input rate; no user recording is used.
                    import numpy as np
                    samples = np.frombuffer(audio, dtype="<i2").astype(np.float32)
                    pcm = np.interp(np.arange(0, len(samples), 1.5), np.arange(len(samples)), samples).astype("<i2").tobytes()
                    async def frames():
                        for offset in range(0, len(pcm), 3200):
                            yield pcm[offset:offset+3200]
                            await asyncio.sleep(0.1)
                    async def partial(_text): pass
                    transcript = await speech.recognize(frames(), partial)
                    if not transcript.strip(): raise ValueError("empty_transcript")
                print(json.dumps({"service": name, "status": "passed", "seconds": round(time.monotonic()-started, 2)}), flush=True)
            except Exception as exc:
                failed += 1
                print(json.dumps({"service": name, "status": "failed", "code": getattr(exc, "code", type(exc).__name__), "provider_code": getattr(exc, "provider_code", ""), "cause": type(exc.__cause__).__name__ if exc.__cause__ else "", "message": str(exc) if hasattr(exc, "code") else "Synthetic audio unavailable"}, ensure_ascii=False), flush=True)
    finally:
        if llm.client: await llm.client.close()
    print("Preview audio: .cache/voice-preview.wav (synthetic speech only)")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__": asyncio.run(main())
