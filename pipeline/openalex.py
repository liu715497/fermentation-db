"""OpenAlex：補上被引用數、文章類型與期刊 2 年平均被引用數（仿 IF 計算，非 Clarivate IF）。

不需金鑰即可使用；有 OPENALEX_API_KEY 時每日額度較高。查不到的文獻欄位留空，計分時不列入平均。
"""

from __future__ import annotations

import time

import requests

API = "https://api.openalex.org"
BATCH = 100  # OpenAlex 單一篩選條件最多 100 個值


def _get(session: requests.Session, path: str, params: dict, api_key: str = "") -> dict:
    if api_key:
        params = {**params, "api_key": api_key}
    for attempt in range(3):
        r = session.get(f"{API}/{path}", params=params, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 ** attempt * 2)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"OpenAlex 暫時無法服務：{path}")


def norm_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    d = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if d.startswith(prefix):
            d = d[len(prefix):]
    return d or None


def parse_works(data: dict) -> dict[str, dict]:
    out = {}
    for w in data.get("results", []):
        doi = norm_doi(w.get("doi"))
        src = (w.get("primary_location") or {}).get("source") or {}
        if doi:
            out[doi] = {"cited_by_count": w.get("cited_by_count"), "work_type": w.get("type"),
                        "issn_l": src.get("issn_l"), "journal_name": src.get("display_name")}
    return out


def parse_sources(data: dict) -> dict[str, float]:
    out = {}
    for s in data.get("results", []):
        val = (s.get("summary_stats") or {}).get("2yr_mean_citedness")
        if s.get("issn_l") and val is not None:
            out[s["issn_l"]] = round(float(val), 2)
    return out


def enrich(articles: list[dict], session: requests.Session | None = None, api_key: str = "") -> int:
    """就地補上 cited_by_count、work_type、journal_2yr；回傳查到的篇數。"""
    session = session or requests.Session()
    by_doi = {norm_doi(a.get("doi")): a for a in articles if norm_doi(a.get("doi"))}
    found: dict[str, dict] = {}
    dois = list(by_doi)
    for i in range(0, len(dois), BATCH):
        chunk = dois[i:i + BATCH]
        data = _get(session, "works", {"filter": "doi:" + "|".join(f"https://doi.org/{d}" for d in chunk),
                                       "select": "doi,cited_by_count,type,primary_location", "per_page": BATCH}, api_key)
        found.update(parse_works(data))
    issns = sorted({w["issn_l"] for w in found.values() if w.get("issn_l")})
    metric: dict[str, float] = {}
    for i in range(0, len(issns), BATCH):
        data = _get(session, "sources", {"filter": "issn:" + "|".join(issns[i:i + BATCH]),
                                         "select": "issn_l,summary_stats", "per_page": BATCH}, api_key)
        metric.update(parse_sources(data))
    for doi, w in found.items():
        a = by_doi[doi]
        a.update(cited_by_count=w["cited_by_count"], work_type=w["work_type"],
                 journal_2yr=metric.get(w.get("issn_l")), metrics_source="OpenAlex")
    return len(found)
