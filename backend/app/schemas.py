from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class LoginInput(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    token: str
    user: "UserRead"


class UserRead(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    email: str = ""
    phone: str = ""
    department_name: str = ""
    position_name: str = ""
    external_provider: str = "local"

    class Config:
        from_attributes = True


class PersonaPayload(BaseModel):
    customer_name: str = ""
    gender: str = ""
    age: Optional[int] = None
    identity: str = ""
    background: str = ""
    target: str = ""
    personality: str = ""
    objections: list[str] = Field(default_factory=list)
    risk_preference: str = ""
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class ScriptItemPayload(BaseModel):
    id: Optional[int] = None
    item_type: Literal["standard", "question", "forbidden", "knowledge", "compliance", "objection_handling"]
    stage: Literal["any", "opening", "needs", "explain", "objection", "compliance", "closing"] = "any"
    intent_tags: list[str] = Field(default_factory=list)
    risk_tags: list[str] = Field(default_factory=list)
    priority: int = Field(default=50, ge=0, le=100)
    enabled: bool = True
    title: str = ""
    content: str
    sort_order: int = 0


class EvaluationDimensionPayload(BaseModel):
    id: Optional[int] = None
    name: str
    weight: float = Field(ge=0, le=100)
    scoring_criteria: str = ""
    deduction_rules: list[str] = Field(default_factory=list)
    improvement_advice: str = ""
    risk_triggers: list[str] = Field(default_factory=list)
    sort_order: int = 0


class ActivityPayload(BaseModel):
    title: str
    description: str = ""
    training_goal: str = ""
    average_minutes: int = Field(default=15, ge=1, le=240)
    opening_line: str = ""
    entry_description: str = ""
    chat_background_type: Literal["preset", "upload", "url"] = "preset"
    chat_background_value: str = "aurora"
    chat_background_overlay: float = Field(default=0.42, ge=0, le=0.85)
    voice_settings: dict[str, Any] = Field(default_factory=dict)
    status: Literal["draft", "published", "offline"] = "draft"
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    persona: PersonaPayload = Field(default_factory=PersonaPayload)
    script_items: list[ScriptItemPayload] = Field(default_factory=list)
    dimensions: list[EvaluationDimensionPayload] = Field(default_factory=list)


class PersonaRead(PersonaPayload):
    id: int
    activity_id: int

    class Config:
        from_attributes = True


class ScriptItemRead(ScriptItemPayload):
    id: int
    activity_id: int

    class Config:
        from_attributes = True


class EvaluationDimensionRead(EvaluationDimensionPayload):
    id: int
    activity_id: int

    class Config:
        from_attributes = True


class ActivityRead(BaseModel):
    id: int
    title: str
    description: str
    training_goal: str
    average_minutes: int
    opening_line: str
    entry_description: str
    chat_background_type: str
    chat_background_value: str
    chat_background_overlay: float
    voice_settings: dict[str, Any] = Field(default_factory=dict)
    status: str
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    persona: Optional[PersonaRead] = None
    script_items: list[ScriptItemRead] = Field(default_factory=list)
    dimensions: list[EvaluationDimensionRead] = Field(default_factory=list)

    class Config:
        from_attributes = True


class PublicActivityRead(BaseModel):
    id: int
    title: str
    description: str
    training_goal: str
    average_minutes: int
    entry_description: str
    chat_background_type: str
    chat_background_value: str
    chat_background_overlay: float
    voice_settings: dict[str, Any] = Field(default_factory=dict)
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    persona: Optional[PersonaRead] = None

    class Config:
        from_attributes = True


class StartSessionInput(BaseModel):
    activity_id: int


class ChatInput(BaseModel):
    content: str
    input_mode: Literal["text", "voice"] = "text"


class SceneGenerationInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)


class SceneGenerationResult(BaseModel):
    title: str = ""
    description: str = ""
    training_goal: str = ""
    average_minutes: int = Field(default=15, ge=1, le=240)
    opening_line: str = ""
    entry_description: str = ""
    persona: PersonaPayload = Field(default_factory=PersonaPayload)


class MessageRead(BaseModel):
    id: int
    role: str
    content: str
    input_mode: str
    audio_url: str = ""
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    class Config:
        from_attributes = True


class HintResult(BaseModel):
    message: MessageRead


class SessionRead(BaseModel):
    id: int
    activity_id: int
    user_id: int
    status: str
    assessment_status: str = "not_submitted"
    report: Optional[dict[str, Any]]
    state_json: dict[str, Any] = Field(default_factory=dict)
    submitted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    messages: list[MessageRead] = Field(default_factory=list)

    class Config:
        from_attributes = True


class TranscriptionResult(BaseModel):
    text: str
    provider: str


class UploadResult(BaseModel):
    url: str


class OAuthProviderRead(BaseModel):
    key: str
    name: str
    enabled: bool
    issuer: str = ""

    class Config:
        from_attributes = True


class OAuthAuthorizeResult(BaseModel):
    url: str
    enabled: bool
    detail: str = ""


class SubmitSessionResult(BaseModel):
    session: SessionRead
    report_id: int
    report_status: str


class EvaluationReportRead(BaseModel):
    id: int
    session_id: int
    activity_id: int
    user_id: int
    status: str
    ai_report: Optional[dict[str, Any]] = None
    final_report: Optional[dict[str, Any]] = None
    reviewer_notes: str = ""
    reviewed_by_id: Optional[int] = None
    submitted_at: datetime
    ai_generated_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EvaluationReportUpdate(BaseModel):
    final_report: dict[str, Any]
    reviewer_notes: str = ""


class SpeechSynthesisInput(BaseModel):
    text: str
    voice: str = ""
    speed: float = Field(default=1.0, ge=0.25, le=4.0)


class SpeechSynthesisResult(BaseModel):
    audio_base64: str
    mime_type: str = "audio/mpeg"
    provider: str = "openai-compatible"


class AnalyticsOverview(BaseModel):
    activities: int
    published_activities: int
    users: int
    sessions: int
    submitted_sessions: int
    pending_reviews: int
    approved_reports: int
    average_score: Optional[float] = None
    recent_sessions: list[dict[str, Any]] = Field(default_factory=list)
    dimension_scores: list[dict[str, Any]] = Field(default_factory=list)
    risk_counts: list[dict[str, Any]] = Field(default_factory=list)


TokenResponse.model_rebuild()
