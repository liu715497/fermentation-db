"""證據等級對應（PIS「證據等級對應」）。等級由 study_type 決定，不由 AI 判定。"""

STUDY_TYPE_LEVEL = {
    "meta_analysis": "A",
    "systematic_review": "A",
    "rct": "A",
    "non_rct_human": "B",
    "observational": "B",
    "animal": "C",
    "in_vitro": "D",
    "review": "E",
    "opinion": "E",
}
SCORED_LEVELS = ("A", "B", "C", "D")  # E 不計分


def level_for(study_type: str) -> str:
    try:
        return STUDY_TYPE_LEVEL[study_type]
    except KeyError:
        raise ValueError(f"未知的 study_type：{study_type!r}") from None


def best_level(levels) -> str | None:
    """回傳最強等級（A 最強）；只計 A–D。"""
    scored = [lv for lv in levels if lv in SCORED_LEVELS]
    return min(scored) if scored else None
