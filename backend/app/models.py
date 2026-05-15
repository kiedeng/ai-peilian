from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from backend.app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(20), nullable=False, default="student")
    display_name = Column(String(100), nullable=False, default="")
    email = Column(String(200), nullable=False, default="")
    phone = Column(String(60), nullable=False, default="")
    department_name = Column(String(200), nullable=False, default="")
    position_name = Column(String(200), nullable=False, default="")
    external_provider = Column(String(80), nullable=False, default="local")
    external_subject = Column(String(200), nullable=False, default="")
    external_synced_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class OAuthProvider(Base):
    __tablename__ = "oauth_providers"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(80), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    issuer = Column(String(500), nullable=False, default="")
    client_id = Column(String(200), nullable=False, default="")
    authorize_url = Column(String(500), nullable=False, default="")
    token_url = Column(String(500), nullable=False, default="")
    userinfo_url = Column(String(500), nullable=False, default="")
    scopes = Column(String(500), nullable=False, default="openid profile email")
    enabled = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class TrainingActivity(Base):
    __tablename__ = "training_activities"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    training_goal = Column(Text, nullable=False, default="")
    average_minutes = Column(Integer, nullable=False, default=15)
    opening_line = Column(Text, nullable=False, default="")
    entry_description = Column(Text, nullable=False, default="")
    chat_background_type = Column(String(20), nullable=False, default="preset")
    chat_background_value = Column(String(500), nullable=False, default="aurora")
    chat_background_overlay = Column(Float, nullable=False, default=0.42)
    voice_settings = Column(JSON, nullable=False, default=dict)
    status = Column(String(20), nullable=False, default="draft")
    starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    persona = relationship("ScenarioPersona", back_populates="activity", uselist=False, cascade="all, delete-orphan")
    script_items = relationship("ScriptItem", back_populates="activity", cascade="all, delete-orphan", order_by="ScriptItem.sort_order")
    dimensions = relationship("EvaluationDimension", back_populates="activity", cascade="all, delete-orphan", order_by="EvaluationDimension.sort_order")
    sessions = relationship("PracticeSession", back_populates="activity", cascade="all, delete-orphan")


class ScenarioPersona(Base):
    __tablename__ = "scenario_personas"

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(Integer, ForeignKey("training_activities.id"), nullable=False, unique=True)
    customer_name = Column(String(100), nullable=False, default="")
    gender = Column(String(20), nullable=False, default="")
    age = Column(Integer, nullable=True)
    identity = Column(String(200), nullable=False, default="")
    background = Column(Text, nullable=False, default="")
    target = Column(Text, nullable=False, default="")
    personality = Column(Text, nullable=False, default="")
    objections = Column(JSON, nullable=False, default=list)
    risk_preference = Column(Text, nullable=False, default="")
    difficulty = Column(String(20), nullable=False, default="medium")

    activity = relationship("TrainingActivity", back_populates="persona")


class ScriptItem(Base):
    __tablename__ = "script_items"

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(Integer, ForeignKey("training_activities.id"), nullable=False, index=True)
    item_type = Column(String(40), nullable=False, index=True)
    title = Column(String(200), nullable=False, default="")
    content = Column(Text, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)

    activity = relationship("TrainingActivity", back_populates="script_items")


class EvaluationDimension(Base):
    __tablename__ = "evaluation_dimensions"

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(Integer, ForeignKey("training_activities.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    weight = Column(Float, nullable=False, default=0)
    scoring_criteria = Column(Text, nullable=False, default="")
    deduction_rules = Column(JSON, nullable=False, default=list)
    improvement_advice = Column(Text, nullable=False, default="")
    risk_triggers = Column(JSON, nullable=False, default=list)
    sort_order = Column(Integer, nullable=False, default=0)

    activity = relationship("TrainingActivity", back_populates="dimensions")


class PracticeSession(Base):
    __tablename__ = "practice_sessions"

    id = Column(Integer, primary_key=True, index=True)
    activity_id = Column(Integer, ForeignKey("training_activities.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="active")
    assessment_status = Column(String(30), nullable=False, default="not_submitted")
    report = Column(JSON, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    activity = relationship("TrainingActivity", back_populates="sessions")
    user = relationship("User")
    messages = relationship("PracticeMessage", back_populates="session", cascade="all, delete-orphan", order_by="PracticeMessage.created_at")
    evaluation_report = relationship("EvaluationReport", back_populates="session", uselist=False, cascade="all, delete-orphan")


class PracticeMessage(Base):
    __tablename__ = "practice_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("practice_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    input_mode = Column(String(20), nullable=False, default="text")
    audio_url = Column(String(500), nullable=False, default="")
    metadata_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    session = relationship("PracticeSession", back_populates="messages")


class EvaluationReport(Base):
    __tablename__ = "evaluation_reports"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("practice_sessions.id"), nullable=False, unique=True, index=True)
    activity_id = Column(Integer, ForeignKey("training_activities.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="pending_ai")
    ai_report = Column(JSON, nullable=True)
    final_report = Column(JSON, nullable=True)
    reviewer_notes = Column(Text, nullable=False, default="")
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ai_generated_at = Column(DateTime, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    session = relationship("PracticeSession", back_populates="evaluation_report")
    activity = relationship("TrainingActivity")
    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by_id])
