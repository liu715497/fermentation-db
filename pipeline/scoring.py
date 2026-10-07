"""綜合分數計算（PIS 公式；權重讀自 data/regulations/scoring.yaml）。"""

from __future__ import annotations

import math

from pipeline.evidence import SCORED_LEVELS, best_level

STATUS_RANK = {"available": 0, "confirm": 1, "unavailable": 2}


def worst_status(*statuses: str) -> str:
    return max(statuses, key=lambda s: STATUS_RANK[s])


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))  # Python 內建 round 為銀行家捨入，與規格「四捨五入」不同


def article_view(findings: list[dict]) -> dict[str, dict]:
    """把同一組合的 findings 依文獻彙整。

    一篇文獻可能有多個試驗組：等級取該篇最強者；方向只要有一組 positive 即算支持，
    否則有 negative 算相反，其餘算無差異。
    """
    by_article: dict[str, dict] = {}
    for f in findings:
        if f["level"] not in SCORED_LEVELS:
            continue
        a = by_article.setdefault(f["pmcid"], {"levels": [], "directions": [], "year": f["year"],
                                              "cited_by": f.get("cited_by_count"), "journal": f.get("journal_2yr")})
        a["levels"].append(f["level"])
        a["directions"].append(f["result_direction"])
    for a in by_article.values():
        a["level"] = best_level(a["levels"])
        d = a["directions"]
        a["direction"] = "positive" if "positive" in d else "negative" if "negative" in d else "null"
    return by_article


def _mean_capped(values: list[float], cap: float) -> float:
    """有資料的文獻各自除以 cap（上限 1）後取平均；全部沒有資料時為 0。"""
    vals = [min(v / cap, 1.0) for v in values if v is not None]
    return sum(vals) / len(vals) if vals else 0.0


def score_combination(findings: list[dict], ingredient_status: str, data_year: int, cfg: dict) -> dict | None:
    """findings 每筆需含 pmcid、level、result_direction、year。無 A–D 文獻時回傳 None（不列入清單）。"""
    arts = article_view(findings)
    n = len(arts)
    if n == 0:
        return None
    top = best_level(a["level"] for a in arts.values())
    positive = sum(1 for a in arts.values() if a["direction"] == "positive")
    window = cfg["recency"]["years"]
    recent = sum(1 for a in arts.values() if a["year"] and a["year"] > data_year - window)
    parts = {
        "evidence": float(cfg["level_points"][top]),
        "count": cfg["count"]["weight"] * min(n, cfg["count"]["cap"]) / cfg["count"]["cap"],
        "consistency": cfg["consistency"]["weight"] * positive / n,
        "ingredient": float(cfg["ingredient_points"][ingredient_status]),
        "recency": cfg["recency"]["weight"] * recent / n,
    }
    # 被引用數與期刊指標（v0.5.0）：設定檔沒有這兩項時不計，維持舊版計分
    if "citation" in cfg:
        per_year = [a["cited_by"] / max(1, data_year - a["year"] + 1) if a["cited_by"] is not None and a["year"] else None
                    for a in arts.values()]
        parts["citation"] = cfg["citation"]["weight"] * _mean_capped(per_year, cfg["citation"]["cap_per_year"])
    if "journal" in cfg:
        parts["journal"] = cfg["journal"]["weight"] * _mean_capped([a["journal"] for a in arts.values()], cfg["journal"]["cap"])
    counts = {lv: sum(1 for a in arts.values() if a["level"] == lv) for lv in SCORED_LEVELS}
    return {
        "score": round_half_up(sum(parts.values())),
        "score_parts": {k: round(v, 1) for k, v in parts.items()},
        "top_level": top,
        "n_articles": n,
        "counts_by_level": counts,
        "positive_ratio": round(positive / n, 3),
        "latest_year": max((a["year"] or 0) for a in arts.values()),
    }
