"""SQA TC-D08、TC-D10：格式錯誤指出行號；授權不明不得有擷取內容。"""

from pipeline import validate
from pipeline.io_utils import dump_json, dump_yaml
from tests.test_rules import _raw


def test_tc_d08_yaml_error_reports_line(repo):
    path = repo / "regulations/health_claims.yaml"
    lines = path.read_text(encoding="utf-8").splitlines()
    idx = next(i for i, l in enumerate(lines) if l.startswith("  name_zh:"))
    lines[idx] = "  name_zh 調節血糖"  # 少一個冒號
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    report = validate.run()
    assert not report.ok
    assert any("health_claims.yaml" in e and "行" in e for e in report.errors)


def test_placeholders_warn_or_fail(repo):
    assert validate.run().ok
    strict = validate.run(strict=True)
    assert not strict.ok and any("待填" in e for e in strict.errors)


def test_tc_d10_unknown_license_with_findings_is_error(repo):
    dump_yaml(repo / "literature/articles.yaml", [{"pmcid": "PMC9", "license": "unknown"}])
    dump_json(repo / "literature/raw/PMC9.json", _raw("PMC9"))
    report = validate.run()
    assert any("授權不明" in e for e in report.errors)


def test_raw_schema_violation_reported(repo):
    dump_yaml(repo / "literature/articles.yaml", [{"pmcid": "PMC9", "license": "CC BY"}])
    doc = _raw("PMC9", study_type="case_report")
    dump_json(repo / "literature/raw/PMC9.json", doc)
    assert any("study_type" in e for e in validate.run().errors)
