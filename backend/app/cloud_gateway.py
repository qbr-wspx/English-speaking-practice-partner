"""Small, invite-only multi-user gateway for the friends edition.

Run behind an HTTPS reverse proxy. Provider credentials stay on this server.
The existing conversation app is instantiated against a separate SQLite file
for every redeemed invitation.
"""

import asyncio
import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .application import create_app
from .database import create_database_engine


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class Registry:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / "registry.db"
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS invitations (
                    code_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL,
                    redeemed_at TEXT, user_id TEXT);
                CREATE TABLE IF NOT EXISTS clients (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL, revoked_at TEXT);
                CREATE TABLE IF NOT EXISTS usage (
                    user_id TEXT NOT NULL, day TEXT NOT NULL, action TEXT NOT NULL,
                    count INTEGER NOT NULL, PRIMARY KEY (user_id, day, action));
            """)

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.execute("PRAGMA busy_timeout=15000")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def create_invitation(self, hours: int = 168) -> str:
        if not 1 <= hours <= 720:
            raise ValueError("Invitation lifetime must be 1–720 hours")
        from datetime import timedelta
        code = "LS-" + secrets.token_urlsafe(18)
        expires = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        with self._connect() as db:
            db.execute("INSERT INTO invitations VALUES (?, ?, NULL, NULL)", (_digest(code), expires))
        return code

    def redeem(self, code: str) -> str | None:
        if not isinstance(code, str) or len(code) > 100:
            return None
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT expires_at, redeemed_at FROM invitations WHERE code_hash=?", (_digest(code.strip()),)).fetchone()
            if not row or row[0] <= now or row[1]:
                return None
            user_id = str(uuid4())
            token = secrets.token_urlsafe(32)
            db.execute("UPDATE invitations SET redeemed_at=?, user_id=? WHERE code_hash=?", (now, user_id, _digest(code.strip())))
            db.execute("INSERT INTO clients VALUES (?, ?, ?, NULL)", (_digest(token), user_id, now))
            return token

    def identify(self, token: str) -> str | None:
        if not token or len(token) > 200:
            return None
        with self._connect() as db:
            row = db.execute("SELECT user_id FROM clients WHERE token_hash=? AND revoked_at IS NULL", (_digest(token),)).fetchone()
            return row[0] if row else None

    def revoke(self, token: str) -> bool:
        with self._connect() as db:
            cursor = db.execute("UPDATE clients SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL", (datetime.now(timezone.utc).isoformat(), _digest(token)))
            return bool(cursor.rowcount)

    def charge(self, user_id: str, action: str, per_user: int, global_limit: int) -> bool:
        today = _day()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            used = db.execute("SELECT count FROM usage WHERE user_id=? AND day=? AND action=?", (user_id, today, action)).fetchone()
            total = db.execute("SELECT COALESCE(SUM(count), 0) FROM usage WHERE day=? AND action=?", (today, action)).fetchone()[0]
            if (used and used[0] >= per_user) or total >= global_limit:
                return False
            db.execute("INSERT INTO usage VALUES (?, ?, ?, 1) ON CONFLICT(user_id, day, action) DO UPDATE SET count=count+1", (user_id, today, action))
            return True


class CloudGateway:
    def __init__(self, data_dir: Path | None = None, *, registry: Registry | None = None, app_factory=create_app):
        if os.getenv("LINGO_CLOUD_REQUIRE_CREDENTIALS") == "1" and not all(os.getenv(key) for key in ("DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "DASHSCOPE_WORKSPACE_ID")):
            raise RuntimeError("Cloud service credentials are missing")
        if os.getenv("RAILWAY_ENVIRONMENT") and not os.getenv("RAILWAY_VOLUME_MOUNT_PATH"):
            raise RuntimeError("Attach a persistent volume before starting the friends service")
        storage = data_dir or Path(os.environ.get("LINGO_CLOUD_DATA_DIR") or os.getenv("RAILWAY_VOLUME_MOUNT_PATH") or "cloud-data")
        self.registry = registry or Registry(storage)
        self.app_factory = app_factory
        self.apps = {}
        self.apps_lock = asyncio.Lock()
        self.attempts = {}
        self.tickets = {}
        self.active_sockets = set()
        self.socket_lock = asyncio.Lock()
        self.limits = {"session": (int(os.getenv("LINGO_SESSIONS_PER_DAY", "20")), int(os.getenv("LINGO_TOTAL_SESSIONS_PER_DAY", "200"))),
                       "turn": (int(os.getenv("LINGO_TURNS_PER_DAY", "80")), int(os.getenv("LINGO_TOTAL_TURNS_PER_DAY", "800"))),
                       "replay": (int(os.getenv("LINGO_REPLAYS_PER_DAY", "30")), int(os.getenv("LINGO_TOTAL_REPLAYS_PER_DAY", "300"))),
                       "generate": (int(os.getenv("LINGO_GENERATIONS_PER_DAY", "5")), int(os.getenv("LINGO_TOTAL_GENERATIONS_PER_DAY", "50"))),
                       "review": (int(os.getenv("LINGO_REVIEWS_PER_DAY", "20")), int(os.getenv("LINGO_TOTAL_REVIEWS_PER_DAY", "200")))}

    @staticmethod
    def _headers(scope):
        return {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}

    @staticmethod
    async def _json(send, status, payload, *, cors=False):
        headers = [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]
        if cors:
            headers += [(b"access-control-allow-origin", b"null"), (b"access-control-allow-headers", b"authorization, content-type"), (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS")]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": json.dumps(payload, ensure_ascii=False).encode("utf-8")})

    async def _tenant(self, user_id, token):
        async with self.apps_lock:
            if user_id not in self.apps:
                directory = self.registry.data_dir / "users" / user_id
                directory.mkdir(parents=True, exist_ok=True)
                engine = create_database_engine(f"sqlite:///{(directory / 'cafe-lingo.db').as_posix()}")
                self.apps[user_id] = self.app_factory(engine=engine, token=token)
            return self.apps[user_id]

    def _charge(self, user_id, action):
        per_user, global_limit = self.limits[action]
        return per_user > 0 and global_limit > 0 and self.registry.charge(user_id, action, per_user, global_limit)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                event = await receive()
                if event["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif event["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        if scope["type"] not in ("http", "websocket"):
            return
        path = scope.get("path", "")
        headers = self._headers(scope)
        if scope["type"] == "http":
            if scope.get("method") == "OPTIONS":
                return await self._json(send, 200, {}, cors=headers.get("origin") == "null")
            if path == "/health":
                return await self._json(send, 200, {"status": "ok", "mode": "friends", "deepseek_configured": bool(os.getenv("DEEPSEEK_API_KEY")), "speech_configured": bool(os.getenv("DASHSCOPE_API_KEY") and os.getenv("DASHSCOPE_WORKSPACE_ID"))})
            if path == "/v1/invite/redeem" and scope.get("method") == "POST":
                peer = (scope.get("client") or ("unknown",))[0]
                now = asyncio.get_running_loop().time()
                recent = [time for time in self.attempts.get(peer, []) if now - time < 600]
                global_recent = [time for times in self.attempts.values() for time in times if now - time < 600]
                if len(recent) >= 8 or len(global_recent) >= 200:
                    return await self._json(send, 429, {"detail": "尝试次数过多，请稍后再试。"})
                self.attempts[peer] = recent + [now]
                if len(self.attempts) > 1000:
                    self.attempts = {ip: [time for time in times if now - time < 600] for ip, times in self.attempts.items() if any(now - time < 600 for time in times)}
                data = b""
                while True:
                    event = await receive()
                    data += event.get("body", b"")
                    if len(data) > 1024:
                        return await self._json(send, 413, {"detail": "邀请码格式无效。"})
                    if not event.get("more_body"):
                        break
                try:
                    code = json.loads(data).get("code", "")
                except (ValueError, AttributeError):
                    code = ""
                token = self.registry.redeem(code)
                return await self._json(send, 200 if token else 403, {"token": token} if token else {"detail": "邀请码无效或已使用。"})
        token = ""
        if scope["type"] == "http":
            authorization = headers.get("authorization", "")
            if authorization.startswith("Bearer "):
                token = authorization[7:]
        else:
            from urllib.parse import parse_qs
            ticket = parse_qs(scope.get("query_string", b"").decode("utf-8")).get("ticket", [""])[0]
            now = asyncio.get_running_loop().time()
            token, expires = self.tickets.pop(_digest(ticket), ("", 0)) if ticket else ("", 0)
            if expires < now:
                token = ""
        user_id = self.registry.identify(token)
        if not user_id:
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            return await self._json(send, 401, {"detail": "邀请凭据无效，请联系邀请人。"}, cors=headers.get("origin") == "null")
        if scope["type"] == "http":
            if path == "/v1/ws-ticket" and scope.get("method") == "POST":
                now = asyncio.get_running_loop().time()
                self.tickets = {key: value for key, value in self.tickets.items() if value[1] > now}
                ticket = secrets.token_urlsafe(24)
                self.tickets[_digest(ticket)] = (token, now + 30)
                return await self._json(send, 200, {"ticket": ticket}, cors=headers.get("origin") == "null")
            action = "generate" if path == "/api/scenarios/generate" and scope.get("method") == "POST" else "review" if path.endswith("/review") and scope.get("method") == "POST" else None
            if action and not self._charge(user_id, action):
                return await self._json(send, 429, {"detail": "今天的练习额度已用完，请明天再试。"}, cors=headers.get("origin") == "null")
            return await (await self._tenant(user_id, token))(scope, receive, send)
        if path != "/ws/conversation":
            return await send({"type": "websocket.close", "code": 1008})
        from urllib.parse import urlencode
        scope = {**scope, "query_string": urlencode({"token": token}).encode("utf-8")}
        async with self.socket_lock:
            if user_id in self.active_sockets:
                return await send({"type": "websocket.close", "code": 1008})
            self.active_sockets.add(user_id)
        try:
            async def guarded_receive():
                event = await receive()
                if event.get("type") != "websocket.receive" or not event.get("text"):
                    return event
                try:
                    kind = json.loads(event["text"]).get("type")
                except (ValueError, AttributeError):
                    return event
                action = "session" if kind == "session.start" else "turn" if kind in ("text.submit", "audio.start") else "replay" if kind == "assistant.replay" else None
                if action and not self._charge(user_id, action):
                    await send({"type": "websocket.send", "text": json.dumps({"type": "error", "message": "今天的练习额度已用完，请明天再试。", "stage": "quota"}, ensure_ascii=False)})
                    return {"type": "websocket.disconnect", "code": 1008}
                return event
            await (await self._tenant(user_id, token))(scope, guarded_receive, send)
        finally:
            async with self.socket_lock:
                self.active_sockets.discard(user_id)


app = CloudGateway()
