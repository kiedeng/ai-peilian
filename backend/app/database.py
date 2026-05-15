from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from backend.app.config import get_settings


settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
if settings.database_url.startswith("sqlite:///./"):
    db_path = Path(settings.database_url.replace("sqlite:///./", ""))
    db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_compatible_schema()


def ensure_compatible_schema() -> None:
    """Apply tiny additive schema updates for deployments without migrations."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "training_activities" not in tables:
        return
    additions_by_table = {
        "training_activities": [
            ("chat_background_type", "VARCHAR(20) NOT NULL DEFAULT 'preset'"),
            ("chat_background_value", "VARCHAR(500) NOT NULL DEFAULT 'aurora'"),
            ("chat_background_overlay", "FLOAT NOT NULL DEFAULT 0.42"),
            ("voice_settings", "JSON NOT NULL DEFAULT '{}'"),
        ],
        "users": [
            ("email", "VARCHAR(200) NOT NULL DEFAULT ''"),
            ("phone", "VARCHAR(60) NOT NULL DEFAULT ''"),
            ("department_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
            ("position_name", "VARCHAR(200) NOT NULL DEFAULT ''"),
            ("external_provider", "VARCHAR(80) NOT NULL DEFAULT 'local'"),
            ("external_subject", "VARCHAR(200) NOT NULL DEFAULT ''"),
            ("external_synced_at", "DATETIME"),
        ],
        "practice_sessions": [
            ("assessment_status", "VARCHAR(30) NOT NULL DEFAULT 'not_submitted'"),
            ("submitted_at", "DATETIME"),
        ],
        "practice_messages": [
            ("audio_url", "VARCHAR(500) NOT NULL DEFAULT ''"),
            ("metadata_json", "JSON NOT NULL DEFAULT '{}'"),
        ],
    }
    with engine.begin() as connection:
        for table, additions in additions_by_table.items():
            if table not in tables:
                continue
            columns = {column["name"] for column in inspector.get_columns(table)}
            for name, ddl in additions:
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
