"""SQA TC-D10、TC-D13、TC-D14：授權不明略過、格式錯誤重試後記錄失敗、中斷續跑。"""

import json

from pipeline import extract
from pipeline.io_utils import dump_yaml, load_json, load_yaml
from pipeline.providers.base import Provider

GOOD = json.dumps({"findings": [{
    "is_fermented": True, "organism": {"genus": "Lactobacillus", "species": "plantarum", "strain": None},
    "substrate": "soybean", "study_type": "rct", "outcomes": ["fpg"],
    "result_direction": "positive", "summary_zh": "發酵豆奶降低空腹血糖"}]})


class FakeProvider(Provider):
    name = "fake"

    def __init__(self, replies):
        super().__init__(model="fake-model")
        self.replies = list(replies)
        self.calls = 0

    def complete(self, system, messages):
        self.calls += 1
        return self.replies.pop(0)


def _setup(repo, n=3, licenses=None):
    licenses = licenses or ["CC BY"] * n
    dump_yaml(repo / "literature/articles.yaml",
              [{"pmcid": f"PMC{i}", "license": lic} for i, lic in enumerate(licenses, 1)])
    dump_yaml(repo / "literature/candidates.yaml",
              [{"pmcid": f"PMC{i}", "claim": "glycemic", "status": "pending"} for i in range(1, n + 1)])


ENV = {"EXTRACTOR": "TST"}


def test_success_writes_raw_with_provenance(repo):
    _setup(repo, 1)
    p = FakeProvider([f"```json\n{GOOD}\n```"])
    stats = extract.run("glycemic", p, ENV, None, get_text=lambda _: "text")
    assert stats["done"] == 1
    f = load_json(repo / "literature/raw/PMC1.json")["findings"][0]
    assert f["finding_id"] == "PMC1-1" and f["extraction"]["model"] == "fake-model"


def test_tc_d13_bad_output_retried_then_failed_without_stopping(repo):
    _setup(repo, 2)
    p = FakeProvider(["not json", "still not json", GOOD])
    stats = extract.run("glycemic", p, ENV, None, get_text=lambda _: "text")
    assert stats == {"done": 1, "skipped_license": 0, "already_done": 0, "failed": 1}
    assert p.calls == 3  # 第一篇 2 次（含重試 1 次），第二篇 1 次
    assert load_yaml(repo / "literature/failed.yaml")[0]["pmcid"] == "PMC1"


def test_tc_d14_resume_skips_completed(repo):
    _setup(repo, 3)
    extract.run("glycemic", FakeProvider([GOOD]), ENV, 1, get_text=lambda _: "text")
    # 模擬中斷：候選狀態未更新，但 raw 檔已存在
    cands = load_yaml(repo / "literature/candidates.yaml")
    cands[0]["status"] = "pending"
    dump_yaml(repo / "literature/candidates.yaml", cands)
    p = FakeProvider([GOOD, GOOD])
    stats = extract.run("glycemic", p, ENV, None, get_text=lambda _: "text")
    assert stats["already_done"] == 1 and stats["done"] == 2 and p.calls == 2


def test_tc_d10_unknown_license_not_extracted(repo):
    _setup(repo, 1, licenses=["unknown"])
    p = FakeProvider([])
    stats = extract.run("glycemic", p, ENV, None, get_text=lambda _: "text")
    assert stats["skipped_license"] == 1 and p.calls == 0
    assert not (repo / "literature/raw/PMC1.json").exists()
