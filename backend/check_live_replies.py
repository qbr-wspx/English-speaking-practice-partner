"""Opt-in real API regression check; uses only the synthetic cases below."""
import asyncio
import json
import logging
import time

from app.models import Turn
from app.scenarios import load_scenario
from app.services.llm import DeepSeekService


CASES = [
    ("iced", "What would you like to drink?", "I say iced coffee"),
    ("awkward", "What would you like to drink?", "I want to ask the coffee."),
    ("to_go", "Would you like that for here or in a to-go cup?", "I want a two-goal cap."),
    ("to_go_number", "Would you like that for here or in a to-go cup?", "I want a 2 gold cap."),
    ("fragment", "What size would you like?", "on my"),
    ("unrelated", "What size would you like?", "So, that's it for today's video."),
]


async def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    service = DeepSeekService()
    if not service.configured:
        raise SystemExit("No configured API key available for live verification.")
    failed = 0
    try:
        for name, question, text in CASES:
            started = time.monotonic()
            history = [
                Turn(session_id="regression", role="assistant", text=question),
                Turn(session_id="regression", role="user", text=text),
            ]
            try:
                reply = await service.reply(load_scenario(), history)
                print(json.dumps({
                    "case": name, "input": text, "seconds": round(time.monotonic() - started, 2),
                    **reply.model_dump(),
                }, ensure_ascii=True), flush=True)
            except Exception as exc:
                failed += 1
                print(json.dumps({"case": name, "error_type": type(exc).__name__,
                                  "code": getattr(exc, "code", "unexpected")}), flush=True)
    finally:
        await service.client.close()
    print(f"Live regression: {len(CASES) - failed}/{len(CASES)} usable replies", flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
