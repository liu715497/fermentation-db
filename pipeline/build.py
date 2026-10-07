"""建置網站資料檔（data/build/*.json）。"""

from __future__ import annotations

from datetime import date, datetime

from pipeline import config
from pipeline.evidence import level_for
from pipeline.prompting import render_prompt
from pipeline.io_utils import dump_json, load_json, load_yaml
from pipeline.scoring import score_combination, worst_status
from pipeline.taxonomy import build_alias_map, canonical_name, combo_id

STALE_DAYS = 90  # PES FR-M3-05：法規資料超過 90 天未查核即提醒


def _jsonable(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_jsonable(v) for v in obj]
    return obj


def _ingredient_status(name: str, kind: str, table: dict) -> str:
    return table.get((kind, name.lower()), "confirm")  # 未列入清單者一律「需確認」


def run(today: date | None = None) -> dict:
    today = today or config.now().date()
    reg = config.REG
    claims = load_yaml(reg / "health_claims.yaml", []) or []
    enabled = {c["code"] for c in claims if c.get("enabled")}
    scoring_cfg = load_yaml(reg / "scoring.yaml", {})
    alias_map = build_alias_map(load_yaml(reg / "taxonomy_aliases.yaml", {}))
    ingredients = load_yaml(reg / "ingredients.yaml", []) or []
    ing_table = {(i["type"], i["name"].lower()): i["status"] for i in ingredients}
    articles = {a["pmcid"]: a for a in load_yaml(config.LIT / "articles.yaml", []) or []}
    reviewed = {r["finding_id"]: r for r in load_yaml(config.LIT / "reviewed.yaml", []) or []}

    findings_out, groups = [], {}
    for path in sorted(config.RAW.glob("PMC*.json")):
        doc = load_json(path)
        art = articles.get(doc["pmcid"], {})
        for f in doc["findings"]:
            if not f.get("is_fermented") or f.get("health_claim") not in enabled:
                continue
            f = dict(f)
            if f["finding_id"] in reviewed:
                r = reviewed[f["finding_id"]]
                f["extraction"] = {**f["extraction"], "status": "reviewed",
                                   "reviewer": r.get("reviewer"), "reviewed_at": str(r.get("reviewed_at"))}
            org = f.get("organism") or {}
            name = canonical_name(org.get("genus"), org.get("species"), alias_map)
            f.update({
                "pmcid": doc["pmcid"], "organism_name": name, "level": level_for(f["study_type"]),
                "year": art.get("year"), "license": art.get("license", "unknown"),
                "cited_by_count": art.get("cited_by_count"), "journal_2yr": art.get("journal_2yr"),
                "combo_id": f"{f['health_claim']}::{combo_id(name, f.get('substrate'))}",
            })
            findings_out.append(f)
            groups.setdefault(f["combo_id"], []).append(f)

    combos = []
    for cid, fs in groups.items():
        first = fs[0]
        status = worst_status(
            _ingredient_status(first["organism_name"], "organism", ing_table),
            _ingredient_status(first.get("substrate") or "", "substrate", ing_table),
        )
        scored = score_combination(fs, status, today.year, scoring_cfg)
        if scored is None:
            continue  # 只有 E 級（綜述）的組合不列入清單
        combos.append({
            "combo_id": cid, "health_claim": first["health_claim"], "organism_name": first["organism_name"],
            "substrate": first.get("substrate"), "findings": [f["finding_id"] for f in fs],
            "ingredient_status": status, **scored,
        })
    combos.sort(key=lambda c: (-c["score"], -c["n_articles"], -c["latest_year"]))

    def stale(d) -> bool:
        return d is None or (today - d).days > STALE_DAYS

    regulations = {
        # scoring 與 taxonomy_aliases 供網站「即時文獻檢索」在瀏覽器內用同一套規則計分
        "scoring": scoring_cfg,
        "taxonomy_aliases": (load_yaml(reg / "taxonomy_aliases.yaml", {}) or {}).get("aliases", []),
        "health_claims": claims,
        "laws": load_yaml(reg / "laws.yaml", []) or [],
        "ingredients": ingredients,
        "announcements": load_yaml(reg / "announcements.yaml", []) or [],
    }
    for group in ("health_claims", "laws", "ingredients"):
        for item in regulations[group]:
            item["needs_recheck"] = stale(item.get("checked_at"))

    meta = {
        "data_version": config.now_str(), "edition": "測試版",
        "claims_enabled": sorted(enabled), "n_articles": len({f["pmcid"] for f in findings_out}),
        "n_findings": len(findings_out), "n_combinations": len(combos),
        "articles": {p: articles[p] for p in sorted({f["pmcid"] for f in findings_out}) if p in articles},
    }
    out = config.BUILD
    dump_json(out / "meta.json", _jsonable(meta))
    dump_json(out / "combinations.json", combos)
    dump_json(out / "findings.json", _jsonable(findings_out))
    dump_json(out / "regulations.json", _jsonable(regulations))
    # 擷取指示與本機擷取工具共用同一份檔案，網站即時檢索也讀這份，避免兩邊規則不一致
    prompts = {c["code"]: render_prompt(c) for c in claims if c.get("enabled")}
    dump_json(out / "prompts.json", prompts)
    return {"findings": len(findings_out), "combinations": len(combos)}
