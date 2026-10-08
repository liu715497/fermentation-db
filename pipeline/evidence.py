"""證據等級對應（PIS「證據等級對應」）。等級由 study_type 與應用對象決定，不由 AI 判定。

人類食品（target: human）：人體試驗最強，動物試驗只是模型。
動物飼料（target: animal）：目標動物的飼養試驗最強；其他物種或模型動物次之；人體資料只是間接參考。
"""

LEVEL_MAPS = {
    "human": {
        "meta_analysis": "A", "systematic_review": "A", "rct": "A",
        "non_rct_human": "B", "observational": "B",
        "feeding_trial": "C", "animal": "C",
        "in_vitro": "D", "review": "E", "opinion": "E",
    },
    "animal": {
        "meta_analysis": "A", "systematic_review": "A", "feeding_trial": "A",
        "animal": "B",
        "rct": "C", "non_rct_human": "C", "observational": "C",
        "in_vitro": "D", "review": "E", "opinion": "E",
    },
}
TARGETS = tuple(LEVEL_MAPS)
STUDY_TYPE_LEVEL = LEVEL_MAPS["human"]          # 相容舊程式：所有允許的 study_type 代碼
SCORED_LEVELS = ("A", "B", "C", "D")  # E 不計分


def level_for(study_type: str, target: str = "human") -> str:
    try:
        return LEVEL_MAPS[target][study_type]
    except KeyError:
        raise ValueError(f"未知的 study_type 或應用對象：{study_type!r}／{target!r}") from None


def best_level(levels) -> str | None:
    """回傳最強等級（A 最強）；只計 A–D。"""
    scored = [lv for lv in levels if lv in SCORED_LEVELS]
    return min(scored) if scored else None
