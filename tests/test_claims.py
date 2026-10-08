"""第二階段：新增保健功效只需改 health_claims.yaml，不需改程式。"""

import json
from datetime import date

import pytest
import yaml

from pipeline import build, extract, validate
from pipeline.fetch import get_claim
from pipeline.io_utils import dump_json, dump_yaml, load_json
from pipeline.prompting import render_prompt
from tests.test_extract import FakeProvider
from tests.test_rules import _raw

LIPID = {
    "code": "lipid", "name_zh": "調節血脂", "enabled": True, "focus": "發酵產品對血脂調節",
    "outcomes": [{"code": "tc", "name_zh": "總膽固醇"}, {"code": "tg", "name_zh": "三酸甘油酯"},
                 {"code": "ldl", "name_zh": "低密度脂蛋白膽固醇"}, {"code": "other", "name_zh": "其他"}],
    "human_trial_required": "待填", "evidence_note": None, "prompt_notes": "血脂指標須為血清或血漿數值。",
    "evaluation_method": {"name": "健康食品之調節血脂功效評估方法", "announced": None, "url": "待填", "requirements": "待填"},
    "search_query": '"fermented"[tiab] AND (cholesterol[tiab] OR triglyceride[tiab]) AND open access[filter]',
    "max_candidates": 200, "checked_at": None,
}


@pytest.fixture
def two_claims(repo):
    path = repo / "regulations/health_claims.yaml"
    # 只保留調節血糖再加上測試用的功效，讓測試不受正式設定檔內容影響
    claims = [c for c in yaml.safe_load(path.read_text(encoding="utf-8")) if c["code"] == "glycemic"] + [LIPID]
    dump_yaml(path, claims)
    return repo


def lipid_raw(pmcid, outcome):
    doc = _raw(pmcid)
    doc["findings"][0].update(health_claim="lipid", outcomes=[outcome])
    return doc


def test_prompt_rendered_from_template(two_claims):
    p = render_prompt(get_claim("lipid"))
    assert "發酵產品對血脂調節" in p and "tg（三酸甘油酯）" in p and "血清或血漿" in p
    assert "{{" not in p and "fpg" not in p
    g = render_prompt(get_claim("glycemic"))
    assert "fpg（空腹血糖）" in g and "補充說明" not in g


def test_validate_accepts_new_claim_and_checks_outcomes(two_claims):
    assert validate.run().ok
    assert any("human_trial_required" in e for e in validate.run(strict=True).errors)   # 待填在上線前會被擋下
    dump_yaml(two_claims / "literature/articles.yaml", [{"pmcid": "PMC5", "license": "CC BY"}])
    dump_json(two_claims / "literature/raw/PMC5.json", lipid_raw("PMC5", "fpg"))
    assert any("fpg 不在 lipid" in e for e in validate.run().errors)
    dump_json(two_claims / "literature/raw/PMC5.json", lipid_raw("PMC5", "tg"))
    assert validate.run().ok


def test_claim_config_errors_reported(repo):
    path = repo / "regulations/health_claims.yaml"
    claims = yaml.safe_load(path.read_text(encoding="utf-8"))
    claims[0]["outcomes"] = [{"code": "fpg", "name_zh": "空腹血糖"}]          # 少了 other
    claims[0]["human_trial_required"] = "yes"
    dump_yaml(path, claims)
    errors = validate.run().errors
    assert any("須包含 other" in e for e in errors) and any("human_trial_required" in e for e in errors)


def test_build_outputs_prompt_and_separate_combos_per_claim(two_claims):
    dump_yaml(two_claims / "literature/articles.yaml",
              [{"pmcid": p, "license": "CC BY", "year": 2025, "title": "t", "url": "u"} for p in ("PMC1", "PMC2")])
    dump_json(two_claims / "literature/raw/PMC1.json", _raw("PMC1"))
    dump_json(two_claims / "literature/raw/PMC2.json", lipid_raw("PMC2", "tg"))
    build.run(today=date(2026, 10, 7))
    prompts = load_json(two_claims / "build/prompts.json")
    assert set(prompts) == {"glycemic", "lipid"}
    combos = load_json(two_claims / "build/combinations.json")
    assert sorted(c["health_claim"] for c in combos) == ["glycemic", "lipid"]
    assert len({c["combo_id"] for c in combos}) == 2      # 同菌種、同原料，不同功效分開計分


def test_extract_uses_claim_prompt_and_rejects_foreign_outcomes(two_claims):
    dump_yaml(two_claims / "literature/articles.yaml", [{"pmcid": "PMC7", "license": "CC BY"}])
    dump_yaml(two_claims / "literature/candidates.yaml", [{"pmcid": "PMC7", "claim": "lipid", "status": "pending"}])
    finding = json.loads(json.dumps(lipid_raw("PMC7", "fpg")["findings"][0]))
    for k in ("finding_id", "health_claim", "extraction"):
        finding.pop(k)
    wrong = json.dumps({"findings": [finding]})
    right = json.dumps({"findings": [{**finding, "outcomes": ["tg"]}]})
    seen = []

    class Spy(FakeProvider):
        def complete(self, system, messages):
            seen.append(system)
            return super().complete(system, messages)

    stats = extract.run("lipid", Spy([wrong, right]), {"EXTRACTOR": "T"}, None, get_text=lambda _: "text")
    assert stats["done"] == 1 and "發酵產品對血脂調節" in seen[0]       # 第一次用了血糖指標，重試後改正
    assert load_json(two_claims / "literature/raw/PMC7.json")["findings"][0]["outcomes"] == ["tg"]


def test_animal_target_levels_prompt_and_ingredients(repo):
    """動物飼料主題：目標動物飼養試驗為 A、人體試驗只算間接參考；擷取指示換成飼養範圍；原料清單依 scope 區分。"""
    from pipeline.evidence import level_for
    assert level_for("feeding_trial", "animal") == "A" and level_for("rct", "animal") == "C"
    assert level_for("feeding_trial", "human") == "C" and level_for("rct", "human") == "A"
    feed = get_claim("feed_growth")
    p = render_prompt(feed)
    assert "畜禽或水產動物的飼養" in p and "人類健康有關" not in p and "adg（日增重）" in p

    dump_yaml(repo / "regulations/ingredients.yaml", [
        {"name": "Lactiplantibacillus plantarum", "type": "organism", "status": "available", "scope": "animal",
         "source": "x", "checked_at": None},
        {"name": "soybean", "type": "substrate", "status": "available", "source": "x", "checked_at": None}])   # 未填 scope：兩者皆適用
    dump_yaml(repo / "literature/articles.yaml", [{"pmcid": p_, "license": "CC BY", "year": 2025, "title": "t", "url": "u"} for p_ in ("PMC1", "PMC2")])
    human = _raw("PMC1"); human["findings"][0]["study_type"] = "feeding_trial"
    pig = _raw("PMC2"); pig["findings"][0].update(health_claim="feed_growth", study_type="feeding_trial", outcomes=["adg"])
    dump_json(repo / "literature/raw/PMC1.json", human)
    dump_json(repo / "literature/raw/PMC2.json", pig)
    assert validate.run().ok
    build.run(today=date(2026, 10, 7))
    combos = {c["health_claim"]: c for c in load_json(repo / "build/combinations.json")}
    assert combos["glycemic"]["top_level"] == "C" and combos["feed_growth"]["top_level"] == "A"
    assert combos["feed_growth"]["ingredient_status"] == "available"   # 菌種限飼料可用、原料兩者皆可
    assert combos["glycemic"]["ingredient_status"] == "confirm"        # 同一菌種在人類食品端未列，需確認
