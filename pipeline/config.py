"""路徑、時間與本機設定。"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REG = DATA / "regulations"
LIT = DATA / "literature"
RAW = LIT / "raw"
BUILD = DATA / "build"
PROMPTS = Path(__file__).resolve().parent / "prompts"

TZ = timezone(timedelta(hours=8))  # 專案一律以 UTC+8 記錄時間


def now() -> datetime:
    return datetime.now(TZ)


def now_str() -> str:
    return now().strftime("%Y-%m-%d %H:%M:%S")


def load_env(path: Path | None = None) -> dict[str, str]:
    """讀取本機 .env（不依賴第三方套件）；環境變數優先於檔案內容。"""
    path = path or ROOT / ".env"
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values[key.strip()] = val.strip().strip('"').strip("'")
    for key in list(values) + [
        "AI_PROVIDER", "AI_MODEL", "AI_API_KEY", "AI_BASE_URL", "AI_MAX_TOKENS",
        "AI_TEMPERATURE", "EXTRACTOR", "NCBI_EMAIL", "NCBI_API_KEY",
    ]:
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values
