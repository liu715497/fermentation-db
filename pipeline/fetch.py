"""文獻抓取（GitHub Actions 執行，不需 AI 金鑰）：產生候選清單與書目。"""

from __future__ import annotations

from pipeline import config, openalex
from pipeline.io_utils import dump_yaml, load_yaml
from pipeline.ncbi import NcbiClient

ARTICLES_HEADER = "# 文獻書目（fetch 自動產生，勿手動修改）"
CANDIDATES_HEADER = "# 候選文獻清單（fetch 自動產生；status: pending / done / failed / skipped）"


def get_claim(code: str) -> dict:
    for c in load_yaml(config.REG / "health_claims.yaml", []) or []:
        if c.get("code") == code:
            if not c.get("enabled"):
                raise SystemExit(f"保健功效 {code} 未啟用（health_claims.yaml enabled: false）")
            return c
    raise SystemExit(f"health_claims.yaml 找不到保健功效 {code}")


def run(claim_code: str, client: NcbiClient, openalex_key: str | None = "") -> dict:
    claim = get_claim(claim_code)
    limit = int(claim.get("max_candidates", 200))
    ids = client.search_pmc(" ".join(claim["search_query"].split()))
    # PMC 編號依收錄順序遞增；以編號由大到小取前 N 篇，近似「最近收錄」，不需額外查詢日期
    ids = sorted(set(ids), key=int, reverse=True)[:limit]

    articles = load_yaml(config.LIT / "articles.yaml", []) or []
    candidates = load_yaml(config.LIT / "candidates.yaml", []) or []
    known = {a["pmcid"] for a in articles}
    queued = {(c["pmcid"], c["claim"]) for c in candidates}

    new_ids = [i for i in ids if f"PMC{i}" not in known]
    fetched = client.fetch_metadata(new_ids) if new_ids else []
    stamp = config.now_str()
    if fetched and openalex_key is not None:
        try:
            openalex.enrich(fetched, api_key=openalex_key)
        except Exception as exc:  # noqa: BLE001 —— 引用數查不到不影響抓取，只是該項不計分
            print(f"警告：OpenAlex 查詢失敗，本次文獻沒有被引用數與期刊指標：{exc}")
    for row in fetched:
        row["fetched_at"] = stamp
        articles.append(row)

    added = 0
    for i in ids:
        pmcid = f"PMC{i}"
        if (pmcid, claim_code) not in queued:
            candidates.append({"pmcid": pmcid, "claim": claim_code, "added_at": stamp, "status": "pending"})
            added += 1

    dump_yaml(config.LIT / "articles.yaml", articles, ARTICLES_HEADER)
    dump_yaml(config.LIT / "candidates.yaml", candidates, CANDIDATES_HEADER)
    unknown = sum(1 for r in fetched if r["license"] == "unknown")
    return {"search_hits": len(ids), "new_articles": len(fetched), "new_candidates": added, "unknown_license": unknown}
