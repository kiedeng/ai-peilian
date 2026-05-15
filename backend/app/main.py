from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urlencode

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, joinedload, selectinload

from backend.app.ai_service import AiService
from backend.app.config import ROOT_DIR, get_settings
from backend.app.database import SessionLocal, create_all, get_db
from backend.app.models import EvaluationDimension, EvaluationReport, OAuthProvider, PracticeMessage, PracticeSession, ScenarioPersona, ScriptItem, TrainingActivity, User
from backend.app.schemas import (
    ActivityPayload,
    ActivityRead,
    AnalyticsOverview,
    ChatInput,
    EvaluationReportRead,
    EvaluationReportUpdate,
    LoginInput,
    OAuthAuthorizeResult,
    OAuthProviderRead,
    PublicActivityRead,
    SessionRead,
    SpeechSynthesisInput,
    SpeechSynthesisResult,
    StartSessionInput,
    SubmitSessionResult,
    TokenResponse,
    TranscriptionResult,
    UploadResult,
    UserRead,
)
from backend.app.security import create_token, get_current_user, require_admin, verify_password
from backend.app.seed import seed_initial_data

settings = get_settings()
ai_service = AiService()
UPLOAD_ROOT = ROOT_DIR / "backend" / "data" / "uploads"
BACKGROUND_UPLOAD_DIR = UPLOAD_ROOT / "backgrounds"
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}

app = FastAPI(title="信贷业务 AI 话术陪练", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")


@app.on_event("startup")
def startup() -> None:
    create_all()
    db = next(get_db())
    try:
        seed_initial_data(db)
    finally:
        db.close()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=TokenResponse)
def login(payload: LoginInput, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已停用")
    return TokenResponse(token=create_token(user), user=UserRead.model_validate(user))


@app.get("/api/auth/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@app.get("/api/auth/providers", response_model=list[OAuthProviderRead])
def auth_providers(db: Session = Depends(get_db)) -> list[OAuthProvider]:
    return db.query(OAuthProvider).order_by(OAuthProvider.name.asc()).all()


@app.get("/api/auth/oauth/{provider_key}/authorize", response_model=OAuthAuthorizeResult)
def oauth_authorize(provider_key: str, db: Session = Depends(get_db)) -> OAuthAuthorizeResult:
    provider = db.query(OAuthProvider).filter(OAuthProvider.key == provider_key).first()
    if not provider:
        raise HTTPException(status_code=404, detail="企业登录提供方不存在")
    if not provider.enabled or not provider.authorize_url or not provider.client_id:
        return OAuthAuthorizeResult(url="", enabled=False, detail="企业登录尚未完成配置")
    state = secrets.token_urlsafe(24)
    params = urlencode(
        {
            "client_id": provider.client_id,
            "response_type": "code",
            "scope": provider.scopes,
            "state": state,
            "redirect_uri": f"/api/auth/oauth/{provider.key}/callback",
        }
    )
    return OAuthAuthorizeResult(url=f"{provider.authorize_url}?{params}", enabled=True)


@app.get("/api/auth/oauth/{provider_key}/callback")
def oauth_callback(provider_key: str, code: str | None = None, state: str | None = None, db: Session = Depends(get_db)) -> dict[str, str]:
    provider = db.query(OAuthProvider).filter(OAuthProvider.key == provider_key).first()
    if not provider:
        raise HTTPException(status_code=404, detail="企业登录提供方不存在")
    if not provider.enabled:
        raise HTTPException(status_code=400, detail="企业登录尚未启用")
    raise HTTPException(status_code=501, detail="OAuth 回调已预留，接入具体企业身份服务后启用")


@app.get("/api/admin/activities", response_model=list[ActivityRead])
def admin_list_activities(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[TrainingActivity]:
    return _activity_query(db).order_by(TrainingActivity.updated_at.desc()).all()


@app.post("/api/admin/activities", response_model=ActivityRead)
def admin_create_activity(payload: ActivityPayload, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> TrainingActivity:
    activity = _apply_activity_payload(TrainingActivity(), payload)
    db.add(activity)
    db.commit()
    return _get_activity(db, activity.id)


@app.get("/api/admin/activities/{activity_id}", response_model=ActivityRead)
def admin_get_activity(activity_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> TrainingActivity:
    return _get_activity(db, activity_id)


@app.put("/api/admin/activities/{activity_id}", response_model=ActivityRead)
def admin_update_activity(activity_id: int, payload: ActivityPayload, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> TrainingActivity:
    activity = _get_activity(db, activity_id)
    _apply_activity_payload(activity, payload)
    db.commit()
    return _get_activity(db, activity_id)


@app.delete("/api/admin/activities/{activity_id}")
def admin_delete_activity(activity_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict[str, bool]:
    activity = _get_activity(db, activity_id)
    db.delete(activity)
    db.commit()
    return {"ok": True}


@app.post("/api/admin/activities/{activity_id}/publish", response_model=ActivityRead)
def admin_publish_activity(activity_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> TrainingActivity:
    activity = _get_activity(db, activity_id)
    _validate_publish(activity)
    activity.status = "published"
    activity.updated_at = datetime.utcnow()
    db.commit()
    return _get_activity(db, activity_id)


@app.post("/api/admin/activities/{activity_id}/offline", response_model=ActivityRead)
def admin_offline_activity(activity_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> TrainingActivity:
    activity = _get_activity(db, activity_id)
    activity.status = "offline"
    activity.updated_at = datetime.utcnow()
    db.commit()
    return _get_activity(db, activity_id)


@app.post("/api/admin/activities/{activity_id}/duplicate", response_model=ActivityRead)
def admin_duplicate_activity(activity_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> TrainingActivity:
    source = _get_activity(db, activity_id)
    payload = ActivityPayload.model_validate(ActivityRead.model_validate(source).model_dump())
    payload.title = f"{payload.title} 副本"
    payload.status = "draft"
    activity = _apply_activity_payload(TrainingActivity(), payload)
    db.add(activity)
    db.commit()
    return _get_activity(db, activity.id)


@app.post("/api/admin/uploads/backgrounds", response_model=UploadResult)
async def upload_background(file: UploadFile = File(...), _: User = Depends(require_admin)) -> UploadResult:
    suffix = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not suffix:
        raise HTTPException(status_code=400, detail="仅支持 jpg、png、webp、gif 图片。")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件不能为空。")
    if len(content) > 6 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="背景图片不能超过 6MB。")
    BACKGROUND_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{suffix}"
    (BACKGROUND_UPLOAD_DIR / filename).write_bytes(content)
    return UploadResult(url=f"/uploads/backgrounds/{filename}")


@app.get("/api/public/activities", response_model=list[PublicActivityRead])
def public_activities(_: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TrainingActivity]:
    now = datetime.utcnow()
    return (
        _activity_query(db)
        .filter(TrainingActivity.status == "published")
        .filter((TrainingActivity.starts_at.is_(None)) | (TrainingActivity.starts_at <= now))
        .filter((TrainingActivity.ends_at.is_(None)) | (TrainingActivity.ends_at >= now))
        .order_by(TrainingActivity.updated_at.desc())
        .all()
    )


@app.get("/api/public/activities/{activity_id}", response_model=PublicActivityRead)
def public_activity(activity_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TrainingActivity:
    activity = _get_activity(db, activity_id)
    if not _is_activity_visible(activity):
        raise HTTPException(status_code=404, detail="活动不存在或未发布")
    return activity


@app.post("/api/practice/sessions", response_model=SessionRead)
def start_session(payload: StartSessionInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PracticeSession:
    activity = _get_activity(db, payload.activity_id)
    if not _is_activity_visible(activity):
        raise HTTPException(status_code=400, detail="活动未发布或不在有效期内")
    session = PracticeSession(activity_id=activity.id, user_id=user.id, status="active")
    db.add(session)
    db.flush()
    db.add(PracticeMessage(session_id=session.id, role="ai_customer", input_mode="system", content=activity.opening_line))
    db.commit()
    return _get_session(db, session.id, user)


@app.get("/api/practice/sessions", response_model=list[SessionRead])
def list_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[PracticeSession]:
    query = db.query(PracticeSession).options(selectinload(PracticeSession.messages)).order_by(PracticeSession.updated_at.desc())
    if user.role != "admin":
        query = query.filter(PracticeSession.user_id == user.id)
    return query.all()


@app.get("/api/practice/sessions/{session_id}", response_model=SessionRead)
def get_session(session_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PracticeSession:
    return _get_session(db, session_id, user)


@app.post("/api/practice/sessions/{session_id}/messages", response_model=SessionRead)
async def send_message(session_id: int, payload: ChatInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> PracticeSession:
    session = _append_user_message(session_id, payload, user, db)
    try:
        reply = await ai_service.customer_reply(session.activity, session.messages)
    except HTTPException as exc:
        _append_system_error(session.id, f"模型服务暂时不可用：{exc.detail}", db)
        raise exc
    db.add(PracticeMessage(session_id=session.id, role="ai_customer", content=reply, input_mode="system"))
    session.updated_at = datetime.utcnow()
    db.commit()
    return _get_session(db, session_id, user)


@app.post("/api/practice/sessions/{session_id}/messages/stream")
async def stream_message(session_id: int, payload: ChatInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> StreamingResponse:
    session = _append_user_message(session_id, payload, user, db)
    user_message = session.messages[-1]
    session_id_value = session.id
    user_id = user.id

    async def events() -> AsyncIterator[str]:
        yield _sse("user_message", _message_payload(user_message))
        reply_parts: list[str] = []
        stream_db = next(get_db())
        try:
            stream_user = stream_db.get(User, user_id)
            stream_session = _get_session(stream_db, session_id_value, stream_user)
            async for delta in ai_service.stream_customer_reply(stream_session.activity, stream_session.messages):
                reply_parts.append(delta)
                yield _sse("delta", {"content": delta})
            reply = "".join(reply_parts).strip()
            if reply:
                stream_db.add(PracticeMessage(session_id=session_id_value, role="ai_customer", content=reply, input_mode="system"))
                stream_session.updated_at = datetime.utcnow()
                stream_db.commit()
            done_session = _get_session(stream_db, session_id_value, stream_user)
            yield _sse("done", SessionRead.model_validate(done_session).model_dump(mode="json"))
        except HTTPException as exc:
            _append_system_error(session_id_value, f"模型服务暂时不可用：{exc.detail}", stream_db)
            yield _sse("error", {"detail": exc.detail})
        except Exception as exc:
            _append_system_error(session_id_value, f"模型服务暂时不可用：{exc}", stream_db)
            yield _sse("error", {"detail": str(exc)})
        finally:
            stream_db.close()

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/api/practice/sessions/{session_id}/complete", response_model=SessionRead)
async def complete_session(
    session_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SessionRead:
    result = submit_session(session_id, background_tasks, user, db)
    return result.session


@app.post("/api/practice/sessions/{session_id}/submit", response_model=SubmitSessionResult)
def submit_session(
    session_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmitSessionResult:
    session = _get_session(db, session_id, user)
    if not session.evaluation_report:
        report = EvaluationReport(session_id=session.id, activity_id=session.activity_id, user_id=session.user_id, status="pending_ai")
        db.add(report)
        db.flush()
    else:
        report = session.evaluation_report
    session.status = "completed"
    session.assessment_status = report.status
    session.submitted_at = session.submitted_at or datetime.utcnow()
    session.updated_at = datetime.utcnow()
    db.commit()
    background_tasks.add_task(_auto_run_ai_review, report.id)
    refreshed = _get_session(db, session_id, user)
    return SubmitSessionResult(session=SessionRead.model_validate(refreshed), report_id=report.id, report_status=report.status)


@app.post("/api/speech/transcribe", response_model=TranscriptionResult)
async def transcribe(file: UploadFile = File(...), _: User = Depends(get_current_user)) -> TranscriptionResult:
    content = await file.read()
    text = await ai_service.transcribe(file.filename or "audio.webm", content, file.content_type)
    return TranscriptionResult(text=text, provider="openai-compatible")


@app.post("/api/speech/synthesize", response_model=SpeechSynthesisResult)
async def synthesize(payload: SpeechSynthesisInput, _: User = Depends(get_current_user)) -> SpeechSynthesisResult:
    audio = await ai_service.synthesize(payload.text, payload.voice, payload.speed)
    return SpeechSynthesisResult(audio_base64=audio)


@app.get("/api/reviews", response_model=list[EvaluationReportRead])
def list_reviews(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[EvaluationReport]:
    return db.query(EvaluationReport).order_by(EvaluationReport.updated_at.desc()).all()


@app.get("/api/reviews/{report_id}", response_model=EvaluationReportRead)
def get_review(report_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> EvaluationReport:
    return _get_report(db, report_id)


@app.post("/api/reviews/{report_id}/run-ai", response_model=EvaluationReportRead)
async def run_ai_review(report_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> EvaluationReport:
    _get_report(db, report_id)
    raise HTTPException(status_code=410, detail="AI 评分已在学员提交后自动执行，无需人工触发。")


@app.put("/api/reviews/{report_id}", response_model=EvaluationReportRead)
def update_review(report_id: int, payload: EvaluationReportUpdate, user: User = Depends(require_admin), db: Session = Depends(get_db)) -> EvaluationReport:
    _get_report(db, report_id)
    raise HTTPException(status_code=410, detail="评分报告由 AI 自动生成并发布，不支持人工改分。")


@app.post("/api/reviews/{report_id}/approve", response_model=EvaluationReportRead)
def approve_review(report_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)) -> EvaluationReport:
    _get_report(db, report_id)
    raise HTTPException(status_code=410, detail="AI 评分完成后会自动发布，不支持人工发布。")


@app.get("/api/reports/my", response_model=list[EvaluationReportRead])
def my_reports(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[EvaluationReport]:
    return (
        db.query(EvaluationReport)
        .filter(EvaluationReport.user_id == user.id)
        .filter(EvaluationReport.status == "approved")
        .order_by(EvaluationReport.published_at.desc())
        .all()
    )


@app.get("/api/admin/analytics/overview", response_model=AnalyticsOverview)
def analytics_overview(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> AnalyticsOverview:
    return _analytics_payload(db, None)


@app.get("/api/admin/analytics/activity/{activity_id}", response_model=AnalyticsOverview)
def analytics_activity(activity_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)) -> AnalyticsOverview:
    _get_activity(db, activity_id)
    return _analytics_payload(db, activity_id)


def _activity_query(db: Session):
    return db.query(TrainingActivity).options(
        joinedload(TrainingActivity.persona),
        selectinload(TrainingActivity.script_items),
        selectinload(TrainingActivity.dimensions),
    )


def _get_activity(db: Session, activity_id: int) -> TrainingActivity:
    activity = _activity_query(db).filter(TrainingActivity.id == activity_id).first()
    if not activity:
        raise HTTPException(status_code=404, detail="活动不存在")
    return activity


def _get_session(db: Session, session_id: int, user: User) -> PracticeSession:
    query = db.query(PracticeSession).options(
        joinedload(PracticeSession.activity).joinedload(TrainingActivity.persona),
        joinedload(PracticeSession.activity).selectinload(TrainingActivity.script_items),
        joinedload(PracticeSession.activity).selectinload(TrainingActivity.dimensions),
        selectinload(PracticeSession.messages),
        joinedload(PracticeSession.evaluation_report),
    )
    session = query.filter(PracticeSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="陪练会话不存在")
    if user.role != "admin" and session.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问该会话")
    return session


def _get_report(db: Session, report_id: int) -> EvaluationReport:
    report = db.query(EvaluationReport).filter(EvaluationReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="质检报告不存在")
    return report


def _get_session_for_report(db: Session, report: EvaluationReport) -> PracticeSession:
    session = (
        db.query(PracticeSession)
        .options(
            joinedload(PracticeSession.activity).joinedload(TrainingActivity.persona),
            joinedload(PracticeSession.activity).selectinload(TrainingActivity.script_items),
            joinedload(PracticeSession.activity).selectinload(TrainingActivity.dimensions),
            selectinload(PracticeSession.messages),
        )
        .filter(PracticeSession.id == report.session_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="质检报告关联的陪练会话不存在")
    return session


async def _auto_run_ai_review(report_id: int) -> None:
    db = SessionLocal()
    try:
        report = _get_report(db, report_id)
        if report.status == "approved":
            return
        session = _get_session_for_report(db, report)
        try:
            payload = await ai_service.evaluate(session.activity, session.messages)
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            report.status = "failed"
            report.reviewer_notes = f"AI 自动评分失败：{detail}"
            report.updated_at = datetime.utcnow()
            session.assessment_status = report.status
            session.updated_at = datetime.utcnow()
            db.commit()
            return

        now = datetime.utcnow()
        report.ai_report = payload
        report.final_report = payload
        report.status = "approved"
        report.ai_generated_at = now
        report.published_at = now
        report.updated_at = now
        session.assessment_status = report.status
        session.updated_at = now
        db.commit()
    finally:
        db.close()


def _apply_activity_payload(activity: TrainingActivity, payload: ActivityPayload) -> TrainingActivity:
    for field in [
        "title",
        "description",
        "training_goal",
        "average_minutes",
        "opening_line",
        "entry_description",
        "chat_background_type",
        "chat_background_value",
        "chat_background_overlay",
        "voice_settings",
        "status",
        "starts_at",
        "ends_at",
    ]:
        setattr(activity, field, getattr(payload, field))
    activity.updated_at = datetime.utcnow()
    if activity.persona:
        for key, value in payload.persona.model_dump().items():
            setattr(activity.persona, key, value)
    else:
        activity.persona = ScenarioPersona(**payload.persona.model_dump())
    activity.script_items = [ScriptItem(**item.model_dump(exclude={"id"})) for item in payload.script_items]
    activity.dimensions = [EvaluationDimension(**item.model_dump(exclude={"id"})) for item in payload.dimensions]
    if payload.status == "published":
        _validate_publish(activity)
    return activity


def _validate_publish(activity: TrainingActivity) -> None:
    if not activity.title or not activity.opening_line or not activity.persona:
        raise HTTPException(status_code=400, detail="发布前请完善活动标题、开场语和场景人设")
    total_weight = sum(float(item.weight or 0) for item in activity.dimensions)
    if round(total_weight, 2) != 100:
        raise HTTPException(status_code=400, detail="评价维度权重合计必须等于 100")
    if activity.starts_at and activity.ends_at and activity.starts_at >= activity.ends_at:
        raise HTTPException(status_code=400, detail="开始时间必须早于结束时间")


def _is_activity_visible(activity: TrainingActivity) -> bool:
    now = datetime.utcnow()
    return (
        activity.status == "published"
        and (activity.starts_at is None or activity.starts_at <= now)
        and (activity.ends_at is None or activity.ends_at >= now)
    )


def _append_user_message(session_id: int, payload: ChatInput, user: User, db: Session) -> PracticeSession:
    session = _get_session(db, session_id, user)
    if session.status != "active":
        raise HTTPException(status_code=400, detail="陪练已结束，不能继续发送消息")
    db.add(PracticeMessage(session_id=session.id, role="trainee", content=payload.content, input_mode=payload.input_mode))
    session.updated_at = datetime.utcnow()
    db.commit()
    return _get_session(db, session_id, user)


def _append_system_error(session_id: int, content: str, db: Session) -> None:
    db.add(PracticeMessage(session_id=session_id, role="ai_customer", content=content, input_mode="system"))
    session = db.get(PracticeSession, session_id)
    if session:
        session.updated_at = datetime.utcnow()
    db.commit()


def _analytics_payload(db: Session, activity_id: int | None) -> AnalyticsOverview:
    activity_query = db.query(TrainingActivity)
    session_query = db.query(PracticeSession)
    report_query = db.query(EvaluationReport)
    if activity_id is not None:
        session_query = session_query.filter(PracticeSession.activity_id == activity_id)
        report_query = report_query.filter(EvaluationReport.activity_id == activity_id)

    approved = report_query.filter(EvaluationReport.status == "approved").all()
    scores: list[float] = []
    dimension_totals: dict[str, list[float]] = {}
    risk_counts: dict[str, int] = {}
    for report in approved:
        payload = report.final_report or {}
        if isinstance(payload.get("total_score"), (int, float)):
            scores.append(float(payload["total_score"]))
        for item in payload.get("dimension_scores") or []:
            name = str(item.get("name") or "未命名维度")
            score = item.get("score")
            if isinstance(score, (int, float)):
                dimension_totals.setdefault(name, []).append(float(score))
        for risk in payload.get("compliance_risks") or []:
            phrase = str(risk.get("phrase") or risk.get("rule") or "未命名风险")
            risk_counts[phrase] = risk_counts.get(phrase, 0) + 1

    return AnalyticsOverview(
        activities=activity_query.count(),
        published_activities=activity_query.filter(TrainingActivity.status == "published").count(),
        users=db.query(User).count(),
        sessions=session_query.count(),
        submitted_sessions=session_query.filter(PracticeSession.assessment_status != "not_submitted").count(),
        pending_reviews=report_query.filter(EvaluationReport.status.in_(["pending_ai", "failed"])).count(),
        approved_reports=len(approved),
        average_score=round(sum(scores) / len(scores), 1) if scores else None,
        recent_sessions=[
            {"id": item.id, "activity_id": item.activity_id, "user_id": item.user_id, "status": item.assessment_status, "updated_at": item.updated_at.isoformat()}
            for item in session_query.order_by(PracticeSession.updated_at.desc()).limit(8).all()
        ],
        dimension_scores=[
            {"name": name, "score": round(sum(values) / len(values), 1)}
            for name, values in sorted(dimension_totals.items())
            if values
        ],
        risk_counts=[
            {"phrase": phrase, "count": count}
            for phrase, count in sorted(risk_counts.items(), key=lambda item: item[1], reverse=True)[:10]
        ],
    )


def _message_payload(message: PracticeMessage) -> dict[str, Any]:
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "input_mode": message.input_mode,
        "audio_url": message.audio_url,
        "metadata_json": message.metadata_json,
        "created_at": message.created_at.isoformat(),
    }


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
