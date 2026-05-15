from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env", override=True)


class Settings(BaseModel):
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./backend/data/app.db")
    app_secret_key: str = os.getenv("APP_SECRET_KEY", "dev-change-me")
    token_expire_minutes: int = int(os.getenv("TOKEN_EXPIRE_MINUTES", "1440"))
    cors_origins: list[str] = [
        item.strip()
        for item in os.getenv("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
        if item.strip()
    ]
    openai_api_key: Optional[str] = os.getenv("OPENAI_API_KEY")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    openai_stt_model: str = os.getenv("OPENAI_STT_MODEL", "whisper-1")
    openai_tts_model: str = os.getenv("OPENAI_TTS_MODEL", "tts-1")
    openai_tts_voice: str = os.getenv("OPENAI_TTS_VOICE", "alloy")


@lru_cache
def get_settings() -> Settings:
    return Settings()
