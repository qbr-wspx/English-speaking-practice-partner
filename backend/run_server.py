import os
import sys
from pathlib import Path

import uvicorn
from app.main import app


def ensure_windowed_log_streams() -> None:
    """PyInstaller windowed apps do not provide stdout/stderr to Uvicorn."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_dir = Path(os.getenv("APP_DATA_DIR", Path.cwd()))
    log_dir.mkdir(parents=True, exist_ok=True)
    log_stream = (log_dir / "backend.log").open("a", encoding="utf-8", buffering=1)
    sys.stdout = log_stream
    sys.stderr = log_stream


if __name__ == "__main__":
    ensure_windowed_log_streams()
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("BACKEND_PORT", "18765")),
        log_level="info",
        access_log=False,
    )
