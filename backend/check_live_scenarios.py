"""Real DeepSeek checks with synthetic transcripts, never existing user history."""
import asyncio
import json
import time
import os
from pathlib import Path
from app.models import Turn
from app.scenarios import build_scenario, list_scenarios, Scenario
from app.services.llm import DeepSeekService

inputs = {
    "cafe-ordering": ["A latte, please.", "A medium one with oat milk.", "To go, please."],
    "restaurant-dining": ["I would like grilled chicken, please.", "Please make it without nuts; I am allergic.", "Could I have the bill and pay by card?"],
    "hotel-checkin": ["I have a reservation under Chen for two nights.", "Does my room have Wi-Fi, and is breakfast included?", "What time is check-out, and where can I get my key?"],
    "airport-travel": ["I am flying to London.", "I have one checked bag and would like a window seat.", "Which gate should I go to, and when does boarding start?"],
    "shopping-returns": ["I would like to return this shirt because it is too small.", "Can I exchange it for a medium, and do you need my receipt?", "Yes, I would like to exchange it for that medium one, please."],
    "directions-transit": ["I am trying to get to the museum.", "Should I take the bus or the subway, and which line goes there?", "How much is a ticket, and how long does it take?"],
    "job-interview": ["I am a software developer with two years of experience.", "I am good at teamwork. I built a booking app with a team of three people.", "What does a typical day in this role look like?"],
    "daily-social": ["My day has been good. I finished a project at work.", "I enjoy hiking. What do you like to do on weekends?", "It was nice talking to you. Would you like to go hiking next Saturday?"],
}

async def main():
    service = DeepSeekService(); results = []; failed = 0
    trace = []
    original_create = service.client.chat.completions.create
    async def traced_create(**kwargs):
        response = await original_create(**kwargs)
        trace.append({"finish": response.choices[0].finish_reason if response.choices else "empty", "content": response.choices[0].message.content if response.choices else ""})
        return response
    service.client.chat.completions.create = traced_create
    try:
        scenarios = [Scenario.model_validate(s) for s in list_scenarios()]
        generated = await service.generate_scenario("我想向新同事介绍自己，聊喜欢的运动，并邀请对方周末打羽毛球。", "A2")
        custom = build_scenario("custom-live-check", generated); scenarios.append(custom)
        if os.getenv("LINGO_LIVE_SCENE"): scenarios = [s for s in scenarios if s.id == os.environ["LINGO_LIVE_SCENE"]]
        inputs[custom.id] = ["Hi, I am Alex. I am a developer and joined the team today.", "I love badminton. What sports do you enjoy?", "Would you like to play badminton with me this Saturday?"]
        for scenario in scenarios:
            started = time.monotonic(); history = [Turn(session_id="synthetic", role="assistant", text=scenario.opening_line, translation=scenario.opening_translation, suggested_phrase=scenario.suggested_phrases[0])]
            goals = [{"objective": goal, "completed": False, "evidence": "", "turn_id": ""} for goal in scenario.objectives]
            rounds = []
            try:
                for text in inputs[scenario.id]:
                    user = Turn(session_id="synthetic", role="user", text=text); history.append(user)
                    reply = await service.reply(scenario, history)
                    if "goal_matches" not in reply.model_fields_set:
                        reply.goal_matches = (await service.assess_goals(scenario, history)).goal_matches
                    for match in reply.goal_matches:
                        evidence = next((t for t in history if t.role == "user" and match.evidence in t.text), None)
                        if evidence: goals[match.index].update(completed=True, evidence=match.evidence, turn_id=evidence.id)
                    history.append(Turn(session_id="synthetic", role="assistant", text=reply.reply_en, translation=reply.translation_zh, correction=reply.correction, suggested_phrase=reply.suggested_phrase))
                    rounds.append({"input": text, **reply.model_dump()})
                review = await service.review(scenario, history, goals)
                result = {"scene": scenario.id, "status": "passed", "seconds": round(time.monotonic()-started, 2), "completed_goals": sum(g["completed"] for g in goals)}
                results.append({**result, "scenario": scenario.model_dump(), "rounds": rounds, "goals": goals, "review": review.model_dump()})
                print(json.dumps(result), flush=True)
            except Exception as exc:
                failed += 1; print(json.dumps({"scene": scenario.id, "status": "failed", "code": getattr(exc, "code", type(exc).__name__)}), flush=True)
    finally:
        if service.client: await service.client.close()
    directory = Path(__file__).parents[1] / ".cache"; directory.mkdir(exist_ok=True)
    (directory / "live-scenarios.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    (directory / "live-synthetic-trace.json").write_text(json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Synthetic scenario checks: {len(results)}/{len(scenarios)}. Detailed synthetic results in .cache/live-scenarios.json", flush=True)
    raise SystemExit(1 if failed else 0)

if __name__ == "__main__": asyncio.run(main())
