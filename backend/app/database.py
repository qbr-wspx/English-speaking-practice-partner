import json
import os
import sqlite3
from datetime import timezone
from pathlib import Path
from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select
from .models import ConversationSession, Turn, CustomScenario, utc_now


def create_database_engine(database_url=None):
    if database_url is None:
        directory = Path(os.getenv("APP_DATA_DIR", Path(__file__).parents[2] / "data"))
        directory.mkdir(parents=True, exist_ok=True)
        database_url = f"sqlite:///{(directory / 'cafe-lingo.db').as_posix()}"
    return create_engine(database_url, connect_args={"check_same_thread": False})


def utc_timestamp(value):
    # SQLite stores UTC without a timezone suffix; restore it for browser date parsing.
    return value.replace(tzinfo=timezone.utc).isoformat() if value and value.tzinfo is None else value.isoformat() if value else None


def init_database(engine):
    inspector = inspect(engine)
    additions = {"conversationsession": {"scenario_snapshot": "TEXT NOT NULL DEFAULT ''", "status": "TEXT NOT NULL DEFAULT 'ended'", "progress_json": "TEXT NOT NULL DEFAULT '[]'", "review_json": "TEXT NOT NULL DEFAULT ''"}, "turn": {"request_id": "TEXT NOT NULL DEFAULT ''"}}
    missing = [(table, name, ddl) for table, columns in additions.items() if inspector.has_table(table) for name, ddl in columns.items() if name not in {c['name'] for c in inspector.get_columns(table)}]
    if missing and engine.url.database and engine.url.database != ":memory:":
        source = Path(engine.url.database)
        backup = source.with_suffix(".pre-v2.db")
        if not backup.exists():
            with sqlite3.connect(source) as old, sqlite3.connect(backup) as new:
                old.backup(new)
    with engine.begin() as connection:
        for table, name, ddl in missing:
            connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {ddl}'))
        connection.execute(text("PRAGMA user_version = 2"))
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        for item in db.exec(select(ConversationSession).where(ConversationSession.ended_at == None)).all():
            item.status = "interrupted"
            item.ended_at = utc_now()
            db.add(item)
        db.commit()


def create_conversation(engine, scenario_id, snapshot=""):
    item = ConversationSession(scenario_id=scenario_id, scenario_snapshot=snapshot)
    with Session(engine) as db:
        db.add(item); db.commit(); db.refresh(item)
    return item


def update_conversation(engine, session_id, **values):
    with Session(engine) as db:
        item = db.get(ConversationSession, session_id)
        if item:
            for key, value in values.items(): setattr(item, key, value)
            db.add(item); db.commit()


def end_conversation(engine, session_id, status="ended"):
    update_conversation(engine, session_id, ended_at=utc_now(), status=status)


def add_turn(engine, session_id, role, text, translation="", correction="", suggested_phrase="", request_id=""):
    with Session(engine) as db:
        if request_id:
            existing = db.exec(select(Turn).where(Turn.session_id == session_id, Turn.role == role, Turn.request_id == request_id)).first()
            if existing: return existing
        turn = Turn(session_id=session_id, role=role, text=text, translation=translation, correction=correction, suggested_phrase=suggested_phrase, request_id=request_id)
        db.add(turn); db.commit(); db.refresh(turn)
        return turn


def get_turns(engine, session_id):
    with Session(engine) as db:
        return list(db.exec(select(Turn).where(Turn.session_id == session_id).order_by(Turn.created_at)).all())


def get_conversation(engine, session_id):
    with Session(engine) as db:
        item = db.get(ConversationSession, session_id)
        if not item: return None
        result = item.model_dump()
        result["started_at"] = utc_timestamp(item.started_at)
        result["ended_at"] = utc_timestamp(item.ended_at)
        result["scenario"] = json.loads(item.scenario_snapshot) if item.scenario_snapshot else None
        result["progress"] = json.loads(item.progress_json)
        result["review"] = json.loads(item.review_json) if item.review_json else None
        result["turns"] = get_turns(engine, session_id)
        return result


def list_conversations(engine):
    with Session(engine) as db:
        return [dict(id=i.id, scenario_id=i.scenario_id, started_at=utc_timestamp(i.started_at), ended_at=utc_timestamp(i.ended_at), status=i.status, scenario=json.loads(i.scenario_snapshot) if i.scenario_snapshot else None, progress=json.loads(i.progress_json)) for i in db.exec(select(ConversationSession).order_by(ConversationSession.started_at.desc())).all()]


def delete_conversation(engine, session_id):
    with Session(engine) as db:
        item = db.get(ConversationSession, session_id)
        if not item: return False
        for turn in db.exec(select(Turn).where(Turn.session_id == session_id)).all(): db.delete(turn)
        db.delete(item); db.commit(); return True


def custom_scenarios(engine):
    with Session(engine) as db:
        return [json.loads(i.content) for i in db.exec(select(CustomScenario)).all()]


def save_custom(engine, scenario):
    with Session(engine) as db:
        item = db.get(CustomScenario, scenario.id) or CustomScenario(id=scenario.id, content="")
        item.content = scenario.model_dump_json(); item.updated_at = utc_now()
        db.add(item); db.commit()


def delete_custom(engine, identifier):
    with Session(engine) as db:
        item = db.get(CustomScenario, identifier)
        if not item: return False
        db.delete(item); db.commit(); return True
