from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from backend.app.database import SessionLocal, create_all
from backend.app.main import ai_service, app
from backend.app.seed import seed_initial_data


client = TestClient(app)
create_all()
with SessionLocal() as db:
    seed_initial_data(db)


def login(username="admin", password="admin123"):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.json()["token"]


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_admin_auth_required():
    response = client.get("/api/admin/activities")
    assert response.status_code == 401


def test_admin_can_create_and_publish_activity():
    token = login()
    headers = {"Authorization": f"Bearer {token}"}
    now = datetime.utcnow()
    payload = {
        "title": "测试活动",
        "description": "用于自动化测试",
        "training_goal": "训练合规表达",
        "average_minutes": 12,
        "opening_line": "你好，我想咨询贷款。",
        "entry_description": "测试入口说明",
        "status": "draft",
        "starts_at": (now - timedelta(days=1)).isoformat(),
        "ends_at": (now + timedelta(days=1)).isoformat(),
        "persona": {
            "customer_name": "王强",
            "gender": "男",
            "age": 36,
            "identity": "小微企业主",
            "background": "经营稳定，需要周转。",
            "target": "申请经营贷",
            "personality": "谨慎",
            "objections": ["能保证通过吗？"],
            "risk_preference": "低风险",
            "difficulty": "medium",
        },
        "script_items": [
            {"item_type": "standard", "title": "合规说明", "content": "审批结果以机构审核为准。", "sort_order": 0},
            {"item_type": "forbidden", "title": "禁用", "content": "保证通过", "sort_order": 1},
        ],
        "dimensions": [
            {"name": "合规表达", "weight": 60, "scoring_criteria": "不能承诺结果", "deduction_rules": ["承诺通过"], "improvement_advice": "使用审慎表达", "risk_triggers": ["保证通过"], "sort_order": 0},
            {"name": "需求挖掘", "weight": 40, "scoring_criteria": "询问用途和还款来源", "deduction_rules": [], "improvement_advice": "补充问题", "risk_triggers": [], "sort_order": 1},
        ],
    }
    create_response = client.post("/api/admin/activities", json=payload, headers=headers)
    assert create_response.status_code == 200
    activity_id = create_response.json()["id"]

    publish_response = client.post(f"/api/admin/activities/{activity_id}/publish", headers=headers)
    assert publish_response.status_code == 200
    assert publish_response.json()["status"] == "published"

    student_token = login("student", "student123")
    public_response = client.get("/api/public/activities", headers={"Authorization": f"Bearer {student_token}"})
    assert public_response.status_code == 200
    assert any(item["id"] == activity_id for item in public_response.json())


def test_publish_rejects_invalid_dimension_weight():
    token = login()
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "title": "权重错误活动",
        "description": "",
        "training_goal": "",
        "average_minutes": 10,
        "opening_line": "你好。",
        "entry_description": "",
        "status": "draft",
        "persona": {"customer_name": "赵敏", "identity": "客户"},
        "script_items": [],
        "dimensions": [{"name": "合规表达", "weight": 80, "scoring_criteria": ""}],
    }
    created = client.post("/api/admin/activities", json=payload, headers=headers).json()
    response = client.post(f"/api/admin/activities/{created['id']}/publish", headers=headers)
    assert response.status_code == 400
    assert "权重" in response.json()["detail"]


def test_model_missing_returns_clear_error_for_practice_message():
    original_key = ai_service.settings.openai_api_key
    ai_service.settings.openai_api_key = None
    try:
        student_token = login("student", "student123")
        headers = {"Authorization": f"Bearer {student_token}"}
        activities = client.get("/api/public/activities", headers=headers).json()
        assert activities
        session = client.post("/api/practice/sessions", json={"activity_id": activities[0]["id"]}, headers=headers).json()
        response = client.post(
            f"/api/practice/sessions/{session['id']}/messages",
            json={"content": "您好，我先了解您的资金用途。", "input_mode": "text"},
            headers=headers,
        )
    finally:
        ai_service.settings.openai_api_key = original_key
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_activity_background_fields_roundtrip():
    token = login()
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "title": "背景配置测试",
        "description": "验证活动背景字段",
        "training_goal": "训练专业开场",
        "average_minutes": 10,
        "opening_line": "您好，我想了解经营贷。",
        "entry_description": "带背景的入口说明",
        "chat_background_type": "url",
        "chat_background_value": "https://example.com/background.jpg",
        "chat_background_overlay": 0.55,
        "status": "draft",
        "persona": {"customer_name": "陈先生", "identity": "企业主"},
        "script_items": [],
        "dimensions": [{"name": "合规表达", "weight": 100, "scoring_criteria": ""}],
    }
    created = client.post("/api/admin/activities", json=payload, headers=headers)
    assert created.status_code == 200
    data = created.json()
    assert data["chat_background_type"] == "url"
    assert data["chat_background_value"] == "https://example.com/background.jpg"
    assert data["chat_background_overlay"] == 0.55


def test_background_upload_requires_admin_and_image_type():
    admin_token = login()
    student_token = login("student", "student123")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    student_headers = {"Authorization": f"Bearer {student_token}"}

    forbidden = client.post(
        "/api/admin/uploads/backgrounds",
        headers=student_headers,
        files={"file": ("bg.png", b"fake image", "image/png")},
    )
    assert forbidden.status_code == 403

    invalid = client.post(
        "/api/admin/uploads/backgrounds",
        headers=admin_headers,
        files={"file": ("note.txt", b"not image", "text/plain")},
    )
    assert invalid.status_code == 400

    uploaded = client.post(
        "/api/admin/uploads/backgrounds",
        headers=admin_headers,
        files={"file": ("bg.png", b"fake image", "image/png")},
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["url"].startswith("/uploads/backgrounds/")


def test_stream_message_missing_model_emits_error_event_and_session_refreshes():
    original_key = ai_service.settings.openai_api_key
    ai_service.settings.openai_api_key = None
    try:
        student_token = login("student", "student123")
        headers = {"Authorization": f"Bearer {student_token}"}
        activities = client.get("/api/public/activities", headers=headers).json()
        session = client.post("/api/practice/sessions", json={"activity_id": activities[0]["id"]}, headers=headers).json()
        with client.stream(
            "POST",
            f"/api/practice/sessions/{session['id']}/messages/stream",
            json={"content": "我想先了解客户资金用途。", "input_mode": "text"},
            headers=headers,
        ) as response:
            body = "".join(response.iter_text())
    finally:
        ai_service.settings.openai_api_key = original_key

    assert response.status_code == 200
    assert "event: user_message" in body
    assert "event: error" in body
    refreshed = client.get(f"/api/practice/sessions/{session['id']}", headers=headers)
    assert refreshed.status_code == 200
    assert len(refreshed.json()["messages"]) >= 3


def test_oauth_provider_placeholder_is_available():
    response = client.get("/api/auth/providers")
    assert response.status_code == 200
    providers = response.json()
    assert any(item["key"] == "enterprise" for item in providers)

    authorize = client.get("/api/auth/oauth/enterprise/authorize")
    assert authorize.status_code == 200
    assert authorize.json()["enabled"] is False


def test_submit_session_creates_review_without_showing_report_to_student(monkeypatch):
    async def fake_evaluate(activity, messages):
        raise RuntimeError("queued scoring failed")

    monkeypatch.setattr(ai_service, "evaluate", fake_evaluate)

    student_token = login("student", "student123")
    headers = {"Authorization": f"Bearer {student_token}"}
    activities = client.get("/api/public/activities", headers=headers).json()
    session = client.post("/api/practice/sessions", json={"activity_id": activities[0]["id"]}, headers=headers).json()

    submitted = client.post(f"/api/practice/sessions/{session['id']}/submit", headers=headers)
    assert submitted.status_code == 200
    payload = submitted.json()
    assert payload["report_status"] == "pending_ai"
    assert payload["session"]["assessment_status"] == "pending_ai"
    assert payload["session"]["report"] is None

    reports = client.get("/api/reports/my", headers=headers)
    assert reports.status_code == 200
    assert all(item["id"] != payload["report_id"] for item in reports.json())


def test_submit_session_auto_scores_and_publishes_report(monkeypatch):
    async def fake_evaluate(activity, messages):
        return {
            "total_score": 88,
            "dimension_scores": [{"dimension_id": 1, "name": "合规表达", "weight": 100, "score": 88, "evidence": "表达审慎", "suggestion": "继续保持"}],
            "strengths": ["开场清晰"],
            "issues": [],
            "compliance_risks": [{"phrase": "保证通过", "rule": "禁止承诺", "severity": "high", "evidence": "测试证据"}],
            "improvement_suggestions": ["补充材料清单"],
        }

    monkeypatch.setattr(ai_service, "evaluate", fake_evaluate)

    student_token = login("student", "student123")
    student_headers = {"Authorization": f"Bearer {student_token}"}
    admin_headers = {"Authorization": f"Bearer {login()}"}
    activities = client.get("/api/public/activities", headers=student_headers).json()
    session = client.post("/api/practice/sessions", json={"activity_id": activities[0]["id"]}, headers=student_headers).json()
    submitted = client.post(f"/api/practice/sessions/{session['id']}/submit", headers=student_headers).json()

    generated = client.get(f"/api/reviews/{submitted['report_id']}", headers=admin_headers)
    assert generated.status_code == 200
    assert generated.json()["status"] == "approved"
    assert generated.json()["final_report"]["total_score"] == 88
    assert generated.json()["published_at"] is not None

    my_reports = client.get("/api/reports/my", headers=student_headers)
    assert my_reports.status_code == 200
    assert any(item["id"] == submitted["report_id"] for item in my_reports.json())

    analytics = client.get("/api/admin/analytics/overview", headers=admin_headers)
    assert analytics.status_code == 200
    assert analytics.json()["approved_reports"] >= 1
    assert analytics.json()["average_score"] is not None


def test_submit_session_marks_report_failed_when_ai_scoring_fails(monkeypatch):
    async def fake_evaluate(activity, messages):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(ai_service, "evaluate", fake_evaluate)

    student_token = login("student", "student123")
    student_headers = {"Authorization": f"Bearer {student_token}"}
    admin_headers = {"Authorization": f"Bearer {login()}"}
    activities = client.get("/api/public/activities", headers=student_headers).json()
    session = client.post("/api/practice/sessions", json={"activity_id": activities[0]["id"]}, headers=student_headers).json()
    submitted = client.post(f"/api/practice/sessions/{session['id']}/submit", headers=student_headers).json()

    report = client.get(f"/api/reviews/{submitted['report_id']}", headers=admin_headers)
    assert report.status_code == 200
    assert report.json()["status"] == "failed"
    assert "model unavailable" in report.json()["reviewer_notes"]

    my_reports = client.get("/api/reports/my", headers=student_headers)
    assert my_reports.status_code == 200
    assert all(item["id"] != submitted["report_id"] for item in my_reports.json())
