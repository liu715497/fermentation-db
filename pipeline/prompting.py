"""依 health_claims.yaml 的設定產生擷取指示。所有保健功效共用 prompts/extract_template.md。"""

from __future__ import annotations

from pipeline import config

TEMPLATE = "extract_template.md"

# 研究範圍條件依應用對象（health_claims.yaml target）而定
SCOPE_RULES = {
    "human": "研究目的與人類健康有關（人體、細胞或作為人類模型的動物試驗）；以畜禽或水產飼料效益為目的的研究不算。",
    "animal": ("研究目的與畜禽或水產動物的飼養有關（飼料、飼料原料或飼料添加物）；以人類健康為目的的研究不算。"
               "subjects.population 請寫明動物種類與生長階段，例如離乳仔豬、肉雞、吳郭魚幼魚。"),
}


def render_prompt(claim: dict) -> str:
    """把功效主題、評估指標代碼與補充說明填入範本。"""
    template = (config.PROMPTS / TEMPLATE).read_text(encoding="utf-8")
    outcomes = "、".join(f"{o['code']}（{o['name_zh']}）" for o in claim["outcomes"])
    notes = claim.get("prompt_notes") or ""
    return (template.replace("{{FOCUS}}", claim["focus"])
                    .replace("{{OUTCOMES}}", outcomes)
                    .replace("{{SCOPE_RULE}}", SCOPE_RULES[claim.get("target", "human")])
                    .replace("{{NOTES}}", f"\n補充說明：{notes}\n" if notes else "")).rstrip() + "\n"


def outcome_codes(claim: dict) -> set[str]:
    return {o["code"] for o in claim.get("outcomes") or []}
