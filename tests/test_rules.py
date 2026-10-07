"""SQA TC-D01～D07：證據等級、綜合分數、菌名正規化、權重設定。"""

from datetime import date

import pytest
import yaml

from pipeline import build, config
from pipeline.evidence import level_for
from pipeline.io_utils import dump_json, dump_yaml, load_json
from pipeline.scoring import score_combination
from pipeline.taxonomy import build_alias_map, canonical_name, combo_id

CFG = yaml.safe_load((config.ROOT / "data/regulations/scoring.yaml").read_text(encoding="utf-8"))


def F(pmcid, level, direction="positive", year=2020):
    return {"pmcid": pmcid, "level": level, "result_direction": direction, "year": year}


def test_tc_d01_rct_is_level_a():
    assert level_for("rct") == "A"


def test_tc_d02_animal_is_level_c():
    assert level_for("animal") == "C"


def test_unknown_study_type_rejected():
    with pytest.raises(ValueError):
        level_for("case_report")


def test_tc_d03_score_example():
    # 最高 A、n = 3、支持 2 篇、原料 confirm、近 5 年 1 篇 → 73.7，顯示 74
    fs = [F("P1", "A", year=2025), F("P2", "C", "null", 2015), F("P3", "B", year=2010)]
    r = score_combination(fs, "confirm", 2026, CFG)
    assert r["score_parts"] == {"evidence": 40.0, "count": 12.0, "consistency": 13.3, "ingredient": 5.0, "recency": 3.3}
    assert r["score"] == 74


def test_tc_d04_animal_only_score():
    fs = [F(f"P{i}", "C", year=2010) for i in range(6)]
    assert score_combination(fs, "available", 2026, CFG)["score"] == 65


def test_tc_d05_review_only_combination_excluded():
    assert score_combination([F("P1", "E")], "available", 2026, CFG) is None


def test_multiple_arms_count_as_one_article():
    fs = [F("P1", "C", "null"), F("P1", "A", "positive")]
    r = score_combination(fs, "available", 2026, CFG)
    assert r["n_articles"] == 1 and r["top_level"] == "A" and r["positive_ratio"] == 1.0


def test_tc_d06_old_name_normalised():
    alias = build_alias_map(yaml.safe_load((config.ROOT / "data/regulations/taxonomy_aliases.yaml").read_text(encoding="utf-8")))
    name = canonical_name("Lactobacillus", "plantarum", alias)
    assert name == "Lactiplantibacillus plantarum"
    assert combo_id(name, "Soybean") == "lactiplantibacillus_plantarum__soybean"


def _raw(pmcid, study_type="rct"):
    return {"pmcid": pmcid, "findings": [{
        "finding_id": f"{pmcid}-1", "health_claim": "glycemic", "is_fermented": True,
        "organism": {"genus": "Lactobacillus", "species": "plantarum", "strain": None},
        "substrate": "soybean", "study_type": study_type, "outcomes": ["fpg"],
        "result_direction": "positive", "summary_zh": "測試摘要",
        "extraction": {"provider": "anthropic", "model": "m", "extracted_at": "2026-10-07 10:00:00",
                       "extractor": "T", "status": "auto", "reviewer": None, "reviewed_at": None}}]}


def test_tc_d07_weights_read_from_yaml(repo):
    dump_yaml(repo / "literature/articles.yaml",
              [{"pmcid": "PMC1", "year": 2025, "license": "CC BY", "title": "t", "url": "u"}])
    dump_json(repo / "literature/raw/PMC1.json", _raw("PMC1"))
    build.run(today=date(2026, 10, 7))
    before = load_json(repo / "build/combinations.json")[0]["score"]

    cfg = yaml.safe_load((repo / "regulations/scoring.yaml").read_text(encoding="utf-8"))
    cfg["level_points"]["A"] = 50
    dump_yaml(repo / "regulations/scoring.yaml", cfg)
    build.run(today=date(2026, 10, 7))
    after = load_json(repo / "build/combinations.json")[0]["score"]
    assert after - before == 10


def test_build_merges_review_and_flags_stale(repo):
    dump_yaml(repo / "literature/articles.yaml",
              [{"pmcid": "PMC1", "year": 2025, "license": "CC BY", "title": "t", "url": "u"}])
    dump_json(repo / "literature/raw/PMC1.json", _raw("PMC1"))
    dump_yaml(repo / "literature/reviewed.yaml",
              [{"finding_id": "PMC1-1", "reviewer": "ABC", "reviewed_at": "2026-10-08 09:00:00"}])
    build.run(today=date(2027, 3, 1))
    f = load_json(repo / "build/findings.json")[0]
    assert f["extraction"]["status"] == "reviewed" and f["extraction"]["reviewer"] == "ABC"
    regs = load_json(repo / "build/regulations.json")
    assert regs["health_claims"][0]["needs_recheck"] is True   # 2026-10-07 查核，已超過 90 天
    assert regs["laws"][0]["needs_recheck"] is True            # 從未查核
