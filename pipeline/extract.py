"""文獻擷取（維護人員本機執行，使用本機 .env 的 AI 設定）。

全文只存在記憶體，不寫入倉庫；每篇結果寫成 data/literature/raw/{pmcid}.json。
已有 raw 檔的文獻會跳過，所以中斷後重跑會從未完成處繼續。
"""

from __future__ import annotations

import json
import re
from typing import Callable

from jsonschema import Draft202012Validator

from pipeline import config
from pipeline.fetch import CANDIDATES_HEADER
from pipeline.io_utils import dump_json, dump_yaml, load_yaml
from pipeline.providers import Provider, ProviderError
from pipeline.schema import AI_RESPONSE

FAILED_HEADER = "# 擷取失敗清單（extract 自動產生）"
_ai_validator = Draft202012Validator(AI_RESPONSE)


def normalize_ai(data):
    """部分模型會省略 {"findings": [...]} 外層，直接回傳陣列或單筆物件；統一包回標準格式。"""
    if isinstance(data, list):
        return {"findings": data}
    if isinstance(data, dict) and "findings" not in data and "is_fermented" in data:
        return {"findings": [data]}
    return data


def parse_ai_json(text: str) -> dict:
    """容許模型在 JSON 外包一層 ``` 標記；其餘多餘文字視為格式錯誤。"""
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip())
    data = normalize_ai(json.loads(cleaned))
    errors = sorted(_ai_validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        e = errors[0]
        loc = "/".join(str(p) for p in e.absolute_path) or "(根)"
        raise ValueError(f"{loc}：{e.message}")
    return data


def extract_one(provider: Provider, system: str, article_text: str) -> dict:
    """呼叫 AI；格式不合時把錯誤回傳給 AI 重試一次（PIS「檢核與重試」）。"""
    messages = [{"role": "user", "content": article_text}]
    reply = provider.complete(system, messages)
    try:
        return parse_ai_json(reply)
    except (ValueError, json.JSONDecodeError) as first:
        messages += [
            {"role": "assistant", "content": reply},
            {"role": "user", "content": f"上一個回應不符合格式：{first}。請只輸出修正後的 JSON。"},
        ]
        reply = provider.complete(system, messages)
        return parse_ai_json(reply)  # 第二次仍失敗就讓例外往外拋


def run(claim_code: str, provider: Provider, env: dict[str, str], limit: int | None,
        get_text: Callable[[str], str], log: Callable[[str], None] = print) -> dict:
    extractor = env.get("EXTRACTOR", "").strip()
    if not extractor:
        raise SystemExit("請在 .env 設定 EXTRACTOR（擷取人英文縮寫）")
    system = (config.PROMPTS / f"extract_{claim_code}.md").read_text(encoding="utf-8")

    candidates = load_yaml(config.LIT / "candidates.yaml", []) or []
    articles = {a["pmcid"]: a for a in load_yaml(config.LIT / "articles.yaml", []) or []}
    failed = load_yaml(config.LIT / "failed.yaml", []) or []
    stats = {"done": 0, "skipped_license": 0, "already_done": 0, "failed": 0}

    todo = [c for c in candidates if c["claim"] == claim_code and c["status"] in ("pending", "failed")]
    for cand in todo[:limit] if limit else todo:
        pmcid = cand["pmcid"]
        if (config.RAW / f"{pmcid}.json").exists():
            cand["status"] = "done"
            stats["already_done"] += 1
            continue
        if articles.get(pmcid, {}).get("license", "unknown") == "unknown":
            cand["status"] = "skipped"  # 授權不明只保留書目，不擷取內容
            stats["skipped_license"] += 1
            continue
        try:
            text = get_text(pmcid)
            if not text.strip():
                raise ValueError("取不到可用的全文段落")
            data = extract_one(provider, system, text)
        except ProviderError:
            _save(candidates, failed)
            raise  # 金鑰錯誤或額度用完：保留已完成結果後停止
        except Exception as exc:  # noqa: BLE001 —— 單篇失敗不中斷整批
            cand["status"] = "failed"
            failed = [f for f in failed if f.get("pmcid") != pmcid]
            failed.append({"pmcid": pmcid, "claim": claim_code, "error": str(exc)[:500], "at": config.now_str()})
            stats["failed"] += 1
            log(f"  失敗 {pmcid}：{exc}")
            _save(candidates, failed)
            continue

        stamp = config.now_str()
        findings = []
        for i, f in enumerate(data["findings"], start=1):
            f.update({
                "finding_id": f"{pmcid}-{i}",
                "health_claim": claim_code,
                "extraction": {"provider": provider.name, "model": provider.model, "extracted_at": stamp,
                               "extractor": extractor, "status": "auto", "reviewer": None, "reviewed_at": None},
            })
            findings.append({"finding_id": f.pop("finding_id"), **f})
        dump_json(config.RAW / f"{pmcid}.json", {"pmcid": pmcid, "findings": findings})
        cand["status"] = "done"
        failed = [f for f in failed if f.get("pmcid") != pmcid]
        stats["done"] += 1
        log(f"  完成 {pmcid}：{len(findings)} 筆")
        _save(candidates, failed)  # 每篇存一次，中斷時不遺失進度
    _save(candidates, failed)
    return stats


def _save(candidates: list, failed: list) -> None:
    dump_yaml(config.LIT / "candidates.yaml", candidates, CANDIDATES_HEADER)
    dump_yaml(config.LIT / "failed.yaml", failed, FAILED_HEADER)
