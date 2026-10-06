from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ConversationSession(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    scenario_id: str = Field(index=True)
    started_at: datetime = Field(default_factory=utc_now)
    ended_at: datetime | None = None
    scenario_snapshot: str = ""
    status: str = "active"
    progress_json: str = "[]"
    review_json: str = ""


class Turn(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    session_id: str = Field(foreign_key="conversationsession.id", index=True)
    role: str = Field(index=True)
    text: str
    translation: str = ""
    correction: str = ""
    suggested_phrase: str = ""
    created_at: datetime = Field(default_factory=utc_now)
    request_id: str = Field(default="", index=True)


class CustomScenario(SQLModel, table=True):
    id: str = Field(primary_key=True)
    content: str
    updated_at: datetime = Field(default_factory=utc_now)
