"""依 health_claims.yaml 的設定產生擷取指示。所有保健功效共用 prompts/extract_template.md。"""

from __future__ import annotations

from pipeline import config

TEMPLATE = "extract_template.md"


def render_prompt(claim: dict) -> str:
    """把功效主題、評估指標代碼與補充說明填入範本。"""
    template = (config.PROMPTS / TEMPLATE).read_text(encoding="utf-8")
    outcomes = "、".join(f"{o['code']}（{o['name_zh']}）" for o in claim["outcomes"])
    notes = claim.get("prompt_notes") or ""
    return (template.replace("{{FOCUS}}", claim["focus"])
                    .replace("{{OUTCOMES}}", outcomes)
                    .replace("{{NOTES}}", f"\n補充說明：{notes}\n" if notes else "")).rstrip() + "\n"


def outcome_codes(claim: dict) -> set[str]:
    return {o["code"] for o in claim.get("outcomes") or []}
