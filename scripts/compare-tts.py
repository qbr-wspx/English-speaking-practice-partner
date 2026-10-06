"""Bounded three-voice comparison. Never prints or saves credentials."""
import asyncio
import os
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.services.cloud_speech import CloudSpeech

TEXT = "Welcome back! Would you like coffee and a quiet table by the window?"
VOICES = ("loongcally_v3", "loongabby_v3", "loongannie_v3")
MAX_CHARACTERS = 300

async def main():
    assert len(TEXT) * len(VOICES) <= MAX_CHARACTERS, "TTS spend guard exceeded"
    target = ROOT / ".cache" / "tts-voice-comparison"
    target.mkdir(parents=True, exist_ok=True)
    service = CloudSpeech()
    for voice in VOICES:
        started = time.perf_counter()
        first = None
        frames = []
        async for chunk in service.synthesize(TEXT, voice, 0.95):
            if first is None:
                first = time.perf_counter()
            frames.append(chunk)
        if not frames:
            raise RuntimeError(f"{voice} returned no audio")
        destination = target / f"{voice}.wav"
        with wave.open(str(destination), "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(24000)
            file.writeframes(b"".join(frames))
        print(f"{voice}: {len(TEXT)} characters, first audio {first-started:.2f}s, total {time.perf_counter()-started:.2f}s, {sum(map(len,frames))//2/24000:.2f}s audio")
    print(f"Total billed input at most {len(TEXT)*len(VOICES)} characters. Samples: {target}")

if __name__ == "__main__":
    asyncio.run(main())
