from __future__ import annotations

import json
import base64
from typing import Any, AsyncIterator, Optional

import httpx
from fastapi import HTTPException

from backend.app.config import get_settings
from backend.app.models import PracticeMessage, TrainingActivity


STAGE_KEYWORDS = [
    ("opening", ["你好", "您好", "咨询", "了解", "介绍"]),
    ("needs", ["用途", "资金", "金额", "期限", "流水", "负债", "还款", "经营"]),
    ("explain", ["额度", "利率", "费率", "材料", "审核", "期限", "产品"]),
    ("objection", ["保证", "通过", "最低", "太高", "急", "包装", "征信", "不够"]),
    ("compliance", ["审核为准", "不能承诺", "真实", "风险", "逾期", "费用"]),
    ("closing", ["下一步", "材料", "总结", "确认", "提交"]),
]

STAGE_LABELS = {
    "opening": "开场与信任建立",
    "needs": "需求挖掘",
    "explain": "产品解释",
    "objection": "异议处理",
    "compliance": "合规确认",
    "closing": "收尾推进",
}

RISK_KEYWORDS = {
    "approval_promise": ["保证通过", "百分百", "一定批", "包过", "稳过"],
    "material_packaging": ["包装", "美化流水", "处理征信", "隐瞒", "伪造"],
    "cost_downplay": ["最低利息", "没有风险", "不用管逾期", "零成本"],
}


class AiService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _ensure_configured(self) -> None:
        if not self.settings.openai_api_key:
            raise HTTPException(status_code=503, detail="模型服务未配置：请在 .env 中设置 OPENAI_API_KEY。")

    async def customer_reply(self, activity: TrainingActivity, messages: list[PracticeMessage]) -> str:
        turn = await self.customer_turn(activity, messages)
        return turn["customer_reply"]

    async def customer_turn(self, activity: TrainingActivity, messages: list[PracticeMessage]) -> dict[str, Any]:
        self._ensure_configured()
        try:
            payload = await self._chat(self._customer_messages(activity, messages, structured=True), temperature=0.65, response_format={"type": "json_object"})
            content = payload["choices"][0]["message"]["content"].strip()
            parsed = json.loads(content)
            reply = str(parsed.get("customer_reply") or parsed.get("reply") or "").strip()
            if not reply:
                reply = content
            parsed["customer_reply"] = reply
            parsed.setdefault("state", self.build_conversation_state(activity, messages))
            return parsed
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"模型服务调用失败：{exc}") from exc

    async def stream_customer_reply(self, activity: TrainingActivity, messages: list[PracticeMessage]) -> AsyncIterator[str]:
        self._ensure_configured()
        try:
            async for chunk in self._chat_stream(self._customer_messages(activity, messages), temperature=0.7):
                yield chunk
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"模型流式调用失败：{exc}") from exc

    async def generate_hint(self, activity: TrainingActivity, messages: list[PracticeMessage]) -> str:
        self._ensure_configured()
        state = self.build_conversation_state(activity, messages)
        scripts = self._format_playbook(self.retrieve_playbook(activity, messages, state))
        transcript = "\n".join([f"{self._message_label(m)}: {m.content}" for m in messages if m.role != "ai_hint"])
        prompt = f"""
你是金融信贷业务话术陪练教练。请根据当前对话，给学员生成下一句可参考的标准回复。
要求：
1. 只输出学员可以直接对客户说的一段话，不要解释原因。
2. 语气自然、专业、合规，不承诺审批结果，不诱导包装资料。
3. 尽量结合标准话术、引导问题和客户当前异议。
4. 控制在 1-3 句话。

活动：{activity.title}
训练目标：{activity.training_goal}
当前阶段：{state["stage_label"]}
已识别风险：{"、".join(state["risk_hits"]) or "无"}
已召回话术与规则：
{scripts}

当前对话：
{transcript}
""".strip()
        try:
            payload = await self._chat(
                [{"role": "system", "content": "你只生成学员下一句参考话术。"}, {"role": "user", "content": prompt}],
                temperature=0.35,
            )
            return payload["choices"][0]["message"]["content"].strip()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"提示模型调用失败：{exc}") from exc

    async def generate_scene(self, prompt_text: str) -> dict[str, Any]:
        self._ensure_configured()
        prompt = f"""
你是信贷业务培训活动设计师。请根据管理员的一句话需求，生成活动场景和 AI 客户人设配置 JSON。
只生成以下字段，不要输出 Markdown：
{{
  "title": "活动标题",
  "description": "活动描述",
  "training_goal": "训练目标",
  "average_minutes": 15,
  "opening_line": "AI 客户开场语",
  "entry_description": "学员端入口说明",
  "persona": {{
    "customer_name": "客户姓名",
    "gender": "男|女|其他或空",
    "age": 35,
    "identity": "客户身份",
    "background": "客户背景",
    "target": "客户目标",
    "personality": "性格特点",
    "objections": ["常见异议"],
    "risk_preference": "风险偏好",
    "difficulty": "easy|medium|hard"
  }}
}}

管理员需求：{prompt_text}
""".strip()
        try:
            payload = await self._chat(
                [{"role": "system", "content": "你只返回可解析 JSON。"}, {"role": "user", "content": prompt}],
                temperature=0.45,
                response_format={"type": "json_object"},
            )
            return json.loads(payload["choices"][0]["message"]["content"])
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"场景生成模型调用失败：{exc}") from exc

    async def evaluate(self, activity: TrainingActivity, messages: list[PracticeMessage]) -> dict[str, Any]:
        self._ensure_configured()
        state = self.build_conversation_state(activity, messages)
        transcript = "\n".join([f"{self._message_label(m)}: {m.content}" for m in messages if m.role != "ai_hint"])
        hints = [m.content for m in messages if m.role == "ai_hint"]
        hint_summary = "\n".join([f"{index + 1}. {content}" for index, content in enumerate(hints)]) or "无"
        dimensions = [
            {
                "id": item.id,
                "name": item.name,
                "weight": item.weight,
                "criteria": item.scoring_criteria,
                "deduction_rules": item.deduction_rules,
                "improvement_advice": item.improvement_advice,
                "risk_triggers": item.risk_triggers,
            }
            for item in activity.dimensions
        ]
        prompt = f"""
你是金融信贷业务话术陪练评分员。请严格基于评价维度给出 JSON，不要输出 Markdown。
活动：{activity.title}
训练目标：{activity.training_goal}
会话状态摘要：{json.dumps(state, ensure_ascii=False)}
评价维度：{json.dumps(dimensions, ensure_ascii=False)}
AI 提示使用记录：共 {len(hints)} 次。提示内容如下：
{hint_summary}
评分要求：如果学员使用过 AI 提示，请结合提示次数、提示内容与学员实际发送内容的相似度，在相关维度和总分中体现适当降分；提示越多、越依赖提示，降分越明显。
对话记录：
{transcript}

输出 JSON 结构：
{{
  "total_score": 0-100整数,
  "dimension_scores": [{{"dimension_id": 数字, "name": "维度名", "weight": 数字, "score": 0-100整数, "evidence": "必须引用对话原文证据", "suggestion": "建议"}}],
  "strengths": ["优点"],
  "issues": ["问题"],
  "compliance_risks": [{{"phrase": "风险表达", "rule": "命中规则", "severity": "low|medium|high", "evidence": "证据"}}],
  "improvement_suggestions": ["改进建议"]
}}
""".strip()
        try:
            payload = await self._chat(
                [{"role": "system", "content": "你只返回可解析 JSON。"}, {"role": "user", "content": prompt}],
                temperature=0.2,
                response_format={"type": "json_object"},
            )
            return json.loads(payload["choices"][0]["message"]["content"])
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"评分模型调用失败：{exc}") from exc

    async def transcribe(self, filename: str, content: bytes, content_type: Optional[str]) -> str:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{self.settings.openai_base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                    files={"file": (filename, content, content_type or "application/octet-stream")},
                    data={"model": self.settings.openai_stt_model},
                )
                response.raise_for_status()
                return response.json().get("text", "")
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"语音识别服务调用失败：{exc}") from exc

    async def synthesize(self, text: str, voice: str = "", speed: float = 1.0) -> str:
        self._ensure_configured()
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{self.settings.openai_base_url}/audio/speech",
                    headers={"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self.settings.openai_tts_model,
                        "voice": voice or self.settings.openai_tts_voice,
                        "input": text,
                        "speed": speed,
                    },
                )
                response.raise_for_status()
                return base64.b64encode(response.content).decode("ascii")
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"语音合成服务调用失败：{exc}") from exc

    async def _chat(self, messages: list[dict[str, str]], temperature: float, response_format: Optional[dict[str, str]] = None) -> dict[str, Any]:
        body: dict[str, Any] = {"model": self.settings.openai_model, "messages": messages, "temperature": temperature}
        if response_format:
            body["response_format"] = response_format
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.settings.openai_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"},
                json=body,
            )
            response.raise_for_status()
            return response.json()

    async def _chat_stream(self, messages: list[dict[str, str]], temperature: float) -> AsyncIterator[str]:
        body: dict[str, Any] = {"model": self.settings.openai_model, "messages": messages, "temperature": temperature, "stream": True}
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{self.settings.openai_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}", "Content-Type": "application/json"},
                json=body,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line.removeprefix("data:").strip()
                    if data == "[DONE]":
                        break
                    payload = json.loads(data)
                    choices = payload.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {}).get("content")
                    if delta:
                        yield delta

    def _customer_messages(self, activity: TrainingActivity, messages: list[PracticeMessage], structured: bool = False) -> list[dict[str, str]]:
        state = self.build_conversation_state(activity, messages)
        playbook = self.retrieve_playbook(activity, messages, state)
        api_messages = [{"role": "system", "content": self._customer_prompt(activity, state, playbook, structured=structured)}]
        visible_messages = [message for message in messages if message.role != "ai_hint"]
        for message in visible_messages[-10:]:
            api_messages.append({"role": "assistant" if message.role == "ai_customer" else "user", "content": message.content})
        return api_messages

    def _message_label(self, message: PracticeMessage) -> str:
        return {"ai_customer": "AI客户", "trainee": "学员", "ai_hint": "AI提示"}.get(message.role, message.role)

    def build_conversation_state(self, activity: TrainingActivity, messages: list[PracticeMessage]) -> dict[str, Any]:
        visible_messages = [message for message in messages if message.role != "ai_hint"]
        trainee_text = "\n".join([message.content for message in visible_messages if message.role == "trainee"])
        customer_text = "\n".join([message.content for message in visible_messages if message.role == "ai_customer"])
        joined = f"{trainee_text}\n{customer_text}"
        stage_scores = {stage: sum(joined.count(keyword) for keyword in keywords) for stage, keywords in STAGE_KEYWORDS}
        stage = max(stage_scores, key=stage_scores.get) if any(stage_scores.values()) else "opening"
        if len([m for m in visible_messages if m.role == "trainee"]) >= 6 and stage in {"opening", "needs"}:
            stage = "closing"
        risk_hits = [risk for risk, keywords in RISK_KEYWORDS.items() if any(keyword in trainee_text for keyword in keywords)]
        objections = [item for item in (activity.persona.objections if activity.persona else []) if item and item[:4] in customer_text]
        return {
            "stage": stage,
            "stage_label": STAGE_LABELS.get(stage, stage),
            "turns": len(visible_messages),
            "risk_hits": risk_hits,
            "matched_objections": objections,
            "hint_count": len([message for message in messages if message.role == "ai_hint"]),
        }

    def retrieve_playbook(self, activity: TrainingActivity, messages: list[PracticeMessage], state: Optional[dict[str, Any]] = None, limit: int = 8) -> list[dict[str, Any]]:
        state = state or self.build_conversation_state(activity, messages)
        latest_text = " ".join([message.content for message in messages[-4:]])
        stage = state["stage"]
        risk_hits = set(state["risk_hits"])
        scored: list[tuple[int, Any]] = []
        for item in activity.script_items:
            if not getattr(item, "enabled", True):
                continue
            score = int(getattr(item, "priority", 50) or 50)
            item_stage = getattr(item, "stage", "any") or "any"
            if item_stage == stage:
                score += 45
            elif item_stage == "any":
                score += 15
            else:
                score -= 20
            intent_tags = getattr(item, "intent_tags", None) or []
            risk_tags = getattr(item, "risk_tags", None) or []
            if any(tag and tag in latest_text for tag in intent_tags):
                score += 25
            if risk_hits.intersection(risk_tags):
                score += 35
            if item.item_type in {"forbidden", "compliance"} and risk_hits:
                score += 20
            if item.content and any(token and token in latest_text for token in [item.title, item.content[:8]]):
                score += 10
            scored.append((score, item))
        selected = [item for _, item in sorted(scored, key=lambda pair: (-pair[0], pair[1].sort_order))[:limit]]
        return [
            {
                "id": item.id,
                "type": item.item_type,
                "stage": getattr(item, "stage", "any") or "any",
                "title": item.title,
                "content": item.content,
                "risk_tags": getattr(item, "risk_tags", None) or [],
            }
            for item in selected
        ]

    def _format_playbook(self, playbook: list[dict[str, Any]]) -> str:
        return "\n".join([f"- [{item['type']}|{item['stage']}] {item['title']}: {item['content']}" for item in playbook]) or "无"

    def _customer_prompt(self, activity: TrainingActivity, state: dict[str, Any], playbook: list[dict[str, Any]], structured: bool = False) -> str:
        persona = activity.persona
        objections = "；".join(persona.objections if persona else [])
        output_rule = """
请只输出 JSON：
{
  "customer_reply": "客户要说的话，1-3 句话",
  "detected_intent": "你本轮要表达的客户意图",
  "emotion": "平静|疑虑|焦虑|不满|认可",
  "stage_signal": "opening|needs|explain|objection|compliance|closing",
  "risk_probe": "本轮是否在测试合规风险，没有则为空"
}
""".strip() if structured else "每次回复 1-3 句话，像真实客户一样自然追问。"
        return f"""
你是信贷业务 AI 陪练里的客户，只能扮演客户，不要给学员打分，不要解释系统规则。
活动：{activity.title}
训练目标：{activity.training_goal}
开场语：{activity.opening_line}
客户姓名：{persona.customer_name if persona else ""}
客户身份：{persona.identity if persona else ""}
客户背景：{persona.background if persona else ""}
客户目标：{persona.target if persona else ""}
性格特点：{persona.personality if persona else ""}
风险偏好：{persona.risk_preference if persona else ""}
常见异议：{objections}
难度：{persona.difficulty if persona else "medium"}
当前训练阶段：{state["stage_label"]}
会话状态：{json.dumps(state, ensure_ascii=False)}
本轮可参考的话术与规则：
{self._format_playbook(playbook)}

若学员承诺审批通过、诱导包装资料或弱化费用风险，你可以继续追问细节，但不要替学员纠错。
{output_rule}
""".strip()
