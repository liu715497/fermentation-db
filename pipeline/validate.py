"""資料檢核（PIS validate）。回傳錯誤與警告；有錯誤時 CLI 結束碼為 1。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import re

import yaml
from jsonschema import Draft202012Validator

from pipeline import config
from pipeline.io_utils import load_json
from pipeline.schema import RAW_FILE

PLACEHOLDER = "待填"

REQUIRED_KEYS = {
    "health_claims.yaml": ["code", "name_zh", "enabled", "focus", "outcomes", "human_trial_required",
                           "evaluation_method", "search_query", "max_candidates", "checked_at"],
    "announcements.yaml": ["date", "agency", "title", "url", "affects"],
    "laws.yaml": ["code", "name_zh", "relevant_articles", "url", "checked_at"],
    "ingredients.yaml": ["name", "type", "status", "source", "checked_at"],
}


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _parse_yaml(path: Path, report: Report):
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f"第 {mark.line + 1} 行" if mark else "位置不明"
        report.errors.append(f"{path.name}：YAML 格式錯誤（{where}）：{getattr(exc, 'problem', exc)}")
        return None


def _find_placeholders(obj, trail: str, out: list[str]) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            _find_placeholders(v, f"{trail}.{k}", out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _find_placeholders(v, f"{trail}[{i}]", out)
    elif isinstance(obj, str) and obj.strip() == PLACEHOLDER:
        out.append(trail)


def _check_claim(c: dict, report: Report) -> None:
    """新增保健功效時最容易填錯的地方：指標代碼、是否只採人體試驗。"""
    name = f"health_claims.yaml {c.get('code')}"
    outs = c.get("outcomes")
    if not isinstance(outs, list) or not outs:
        report.errors.append(f"{name}：outcomes 必須是至少一項的清單")
        return
    seen = set()
    for o in outs:
        code = (o or {}).get("code") if isinstance(o, dict) else None
        if not code or not re.fullmatch(r"[a-z0-9_]+", str(code)) or not (o or {}).get("name_zh"):
            report.errors.append(f"{name}：outcomes 每項須有英文小寫 code 與 name_zh，問題項目 {o!r}")
        elif code in seen:
            report.errors.append(f"{name}：outcomes 代碼 {code} 重複")
        seen.add(code)
    if "other" not in seen:
        report.errors.append(f"{name}：outcomes 須包含 other")
    if c.get("human_trial_required") not in (True, False, PLACEHOLDER):
        report.errors.append(f"{name}：human_trial_required 只能是 true、false 或 {PLACEHOLDER}")
    if c.get("enabled") and not str(c.get("focus") or "").strip():
        report.errors.append(f"{name}：啟用的功效必須填 focus（擷取主題）")


def validate_regulations(reg_dir: Path, report: Report, strict: bool = False) -> None:
    for name, keys in REQUIRED_KEYS.items():
        path = reg_dir / name
        if not path.exists():
            report.errors.append(f"{name}：檔案不存在")
            continue
        data = _parse_yaml(path, report)
        if data is None:
            continue
        if not isinstance(data, list):
            report.errors.append(f"{name}：最外層必須是清單")
            continue
        for i, item in enumerate(data):
            missing = [k for k in keys if not isinstance(item, dict) or k not in item]
            if missing:
                report.errors.append(f"{name} 第 {i + 1} 筆：缺少欄位 {', '.join(missing)}")
        holes: list[str] = []
        _find_placeholders(data, name, holes)
        for h in holes:
            (report.errors if strict else report.warnings).append(f"{h}：尚未查證填寫（{PLACEHOLDER}）")

    scoring = reg_dir / "scoring.yaml"
    cfg = _parse_yaml(scoring, report) if scoring.exists() else None
    if scoring.exists() and cfg is not None:
        for key in ("level_points", "count", "consistency", "ingredient_points", "recency"):
            if key not in cfg:
                report.errors.append(f"scoring.yaml：缺少 {key}")
    elif not scoring.exists():
        report.errors.append("scoring.yaml：檔案不存在")

    aliases = reg_dir / "taxonomy_aliases.yaml"
    if aliases.exists():
        _parse_yaml(aliases, report)

    claims = _parse_yaml(reg_dir / "health_claims.yaml", Report()) or []
    codes = {c.get("code") for c in claims if isinstance(c, dict)}
    for c in claims:
        if isinstance(c, dict):
            _check_claim(c, report)
    for ann in _parse_yaml(reg_dir / "announcements.yaml", Report()) or []:
        for code in (ann or {}).get("affects", []) or []:
            if code not in codes:
                report.errors.append(f"announcements.yaml：affects 中的 {code} 不在 health_claims.yaml")

    for name in ("laws.yaml", "ingredients.yaml", "health_claims.yaml"):
        for item in _parse_yaml(reg_dir / name, Report()) or []:
            checked = (item or {}).get("checked_at")
            if checked and not isinstance(checked, date):
                report.errors.append(f"{name}：checked_at 須為 YYYY-MM-DD，目前為 {checked!r}")


def validate_raw(raw_dir: Path, articles: list[dict], report: Report, claims: list[dict] | None = None) -> None:
    validator = Draft202012Validator(RAW_FILE)
    allowed = {c.get("code"): {o.get("code") for o in c.get("outcomes") or [] if isinstance(o, dict)}
               for c in claims or [] if isinstance(c, dict)}
    licenses = {a["pmcid"]: a.get("license", "unknown") for a in articles}
    for path in sorted(raw_dir.glob("PMC*.json")):
        doc = load_json(path)
        for err in validator.iter_errors(doc):
            loc = "/".join(str(p) for p in err.absolute_path) or "(根)"
            report.errors.append(f"raw/{path.name}：{loc}：{err.message}")
        pmcid = doc.get("pmcid") if isinstance(doc, dict) else None
        if pmcid and path.stem != pmcid:
            report.errors.append(f"raw/{path.name}：檔名與 pmcid {pmcid} 不一致")
        for f in (doc or {}).get("findings", []):
            fid = f.get("finding_id", "")
            if pmcid and not fid.startswith(pmcid + "-"):
                report.errors.append(f"raw/{path.name}：finding_id {fid} 與 pmcid 不符")
            codes = allowed.get(f.get("health_claim"))
            if codes is not None:
                bad = [o for o in f.get("outcomes") or [] if o not in codes]
                if bad:
                    report.errors.append(f"raw/{path.name}：{fid} 的指標 {', '.join(bad)} 不在 {f.get('health_claim')} 的 outcomes 中")
        if pmcid and licenses.get(pmcid, "unknown") == "unknown" and doc.get("findings"):
            report.errors.append(f"raw/{path.name}：授權不明的文獻不得有擷取內容")


def run(strict: bool = False, reg_dir: Path | None = None, lit_dir: Path | None = None) -> Report:
    from pipeline.io_utils import load_yaml

    reg_dir = reg_dir or config.REG
    lit_dir = lit_dir or config.LIT
    report = Report()
    validate_regulations(reg_dir, report, strict=strict)
    articles = load_yaml(lit_dir / "articles.yaml", []) or []
    claims = _parse_yaml(reg_dir / "health_claims.yaml", Report()) or []   # 格式錯誤已在上面回報
    validate_raw(lit_dir / "raw", articles, report, claims if isinstance(claims, list) else [])
    return report
