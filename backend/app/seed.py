from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from backend.app.models import EvaluationDimension, OAuthProvider, ScenarioPersona, ScriptItem, TrainingActivity, User
from backend.app.security import hash_password


def seed_initial_data(db: Session) -> None:
    if not db.query(User).filter(User.username == "admin").first():
        db.add(User(username="admin", password_hash=hash_password("admin123"), role="admin", display_name="管理员"))
    if not db.query(User).filter(User.username == "student").first():
        db.add(User(username="student", password_hash=hash_password("student123"), role="student", display_name="演示学员"))
    if not db.query(OAuthProvider).filter(OAuthProvider.key == "enterprise").first():
        db.add(OAuthProvider(key="enterprise", name="企业账号", enabled=False))

    if db.query(TrainingActivity).count() == 0:
        now = datetime.utcnow()
        activity = TrainingActivity(
            title="经营贷客户首次咨询陪练",
            description="训练信贷顾问完成需求挖掘、产品解释、异议处理和合规风险提示。",
            training_goal="在不承诺审批结果的前提下，了解客户经营周转需求并推进下一步材料准备。",
            average_minutes=15,
            opening_line="你好，我想咨询一笔经营周转贷款，但我比较担心审批和费用问题。",
            entry_description="适合新入职信贷顾问进行经营贷接待话术训练。",
            status="published",
            starts_at=now - timedelta(days=1),
            ends_at=now + timedelta(days=30),
            voice_settings={"voice": "杜小雯", "speed": 1.0, "auto_play": True, "default_input_mode": "voice", "continuous_voice": True},
        )
        db.add(activity)
        db.flush()
        db.add(
            ScenarioPersona(
                activity_id=activity.id,
                customer_name="刘伟",
                gender="男",
                age=38,
                identity="社区便利店个体工商户",
                background="店铺经营三年，流水有季节波动，近期需要春节前补货。",
                target="申请 20 万经营周转资金，希望流程快、费用透明。",
                personality="谨慎、爱追问、对承诺类表达敏感。",
                objections=["你们能保证批下来吗？", "利息到底是不是最低？", "如果流水不够能不能包装一下？"],
                risk_preference="低风险偏好，关注综合成本和逾期影响。",
                difficulty="medium",
            )
        )
        script_items = [
            ("standard", "开场承接", "我先了解您的资金用途、经营情况和还款安排，再帮您判断适合的申请路径。"),
            ("standard", "合规说明", "具体额度、费率和审批结果需要以机构审核为准，我不能提前承诺。"),
            ("question", "用途问题", "这笔资金主要用于什么经营场景？"),
            ("question", "还款问题", "您希望的还款周期和每月可承受金额是多少？"),
            ("forbidden", "禁止承诺", "保证通过"),
            ("forbidden", "禁止包装", "包装流水"),
            ("knowledge", "产品知识", "信贷产品会根据用途、征信、流水、负债和还款来源综合评估。"),
            ("compliance", "真实材料", "不得诱导客户伪造、包装、隐瞒或删除资料。"),
        ]
        for index, item in enumerate(script_items):
            db.add(ScriptItem(activity_id=activity.id, item_type=item[0], title=item[1], content=item[2], sort_order=index))
        dimensions = [
            ("开场与信任建立", 10, "礼貌开场、说明沟通目的，让客户愿意继续交流。", ["开场生硬", "过早推产品"], "先承接客户顾虑，再说明沟通目的。", []),
            ("需求挖掘", 20, "了解资金用途、金额、期限、流水、负债和还款来源。", ["只问金额", "未询问还款来源"], "补充用途、资质、还款能力和时间要求。", []),
            ("产品解释准确性", 20, "准确解释额度、费率、期限、材料、审核口径和不确定性。", ["未说明以审核为准"], "明确最终结果以机构审核为准。", ["最低利息", "不用审核"]),
            ("合规表达", 25, "避免承诺结果、诱导包装资料、弱化费用和逾期风险。", ["承诺通过", "诱导包装资料"], "替换承诺式表达，使用审慎合规措辞。", ["保证通过", "百分百下款", "包装", "隐瞒", "处理征信"]),
            ("异议处理", 15, "回应客户对费率、审批、材料、逾期记录等异议。", ["回避异议"], "先承接顾虑，再给出合规解释和下一步。", []),
            ("成交推进与服务礼貌", 10, "总结客户情况、明确下一步动作，并保持礼貌专业。", ["无总结", "没有下一步"], "总结已确认信息并说明材料清单。", []),
        ]
        for index, dimension in enumerate(dimensions):
            db.add(
                EvaluationDimension(
                    activity_id=activity.id,
                    name=dimension[0],
                    weight=dimension[1],
                    scoring_criteria=dimension[2],
                    deduction_rules=dimension[3],
                    improvement_advice=dimension[4],
                    risk_triggers=dimension[5],
                    sort_order=index,
                )
            )
    db.commit()
