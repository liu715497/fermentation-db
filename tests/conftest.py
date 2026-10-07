import shutil
from pathlib import Path

import pytest

from pipeline import config

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """以暫存資料夾模擬倉庫 data/，避免測試改到真實資料。"""
    data = tmp_path / "data"
    shutil.copytree(REPO / "data" / "regulations", data / "regulations")
    (data / "literature" / "raw").mkdir(parents=True)
    (data / "build").mkdir()
    for name in ("articles", "candidates", "reviewed", "failed"):
        (data / "literature" / f"{name}.yaml").write_text("[]\n", encoding="utf-8")
    monkeypatch.setattr(config, "DATA", data)
    monkeypatch.setattr(config, "REG", data / "regulations")
    monkeypatch.setattr(config, "LIT", data / "literature")
    monkeypatch.setattr(config, "RAW", data / "literature" / "raw")
    monkeypatch.setattr(config, "BUILD", data / "build")
    return data
