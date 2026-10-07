"""NCBI E-utilities 與 BioC API 存取。

只使用 PMC 明列允許自動取得的管道（E-utilities、BioC API）。
請求間隔為保守值；確切頻率上限以 NCBI 官方文件為準（README「待查證」）。
"""

from __future__ import annotations

import time
import xml.etree.ElementTree as ET

import requests

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
# BioC API 網址格式待查證（README「待查證」）；集中於此方便修改
BIOC_URL = "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/{pmcid}/unicode"
TOOL = "fermentation-db"
XLINK = "{http://www.w3.org/1999/xlink}href"


class NcbiError(RuntimeError):
    pass


class NcbiClient:
    def __init__(self, email: str, api_key: str = "", session: requests.Session | None = None):
        if not email:
            raise NcbiError("未設定 NCBI_EMAIL（NCBI 要求自動化程式提供聯絡信箱）")
        self.email = email
        self.api_key = api_key
        self.session = session or requests.Session()
        self.interval = 0.15 if api_key else 0.4
        self._last = 0.0

    def _get(self, url: str, params: dict | None = None) -> requests.Response:
        params = dict(params or {})
        if url.startswith(EUTILS):
            params.update({"tool": TOOL, "email": self.email})
            if self.api_key:
                params["api_key"] = self.api_key
        last = None
        for attempt in range(3):
            wait = self.interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                resp = self.session.get(url, params=params, timeout=60)
            except requests.RequestException as exc:
                last = exc
                time.sleep(2 ** attempt * 2)
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                last = NcbiError(f"HTTP {resp.status_code}")
                time.sleep(2 ** attempt * 2)
                continue
            if resp.status_code >= 400:
                raise NcbiError(f"NCBI 回傳 HTTP {resp.status_code}：{url}")
            return resp
        raise NcbiError(f"NCBI 連線失敗（已重試 3 次）：{last}")

    def search_pmc(self, term: str, retmax: int = 10000) -> list[str]:
        """回傳 PMC 數字編號清單。"""
        resp = self._get(f"{EUTILS}/esearch.fcgi",
                         {"db": "pmc", "term": term, "retmax": retmax, "retmode": "json"})
        data = resp.json()
        return data.get("esearchresult", {}).get("idlist", [])

    def fetch_metadata(self, pmc_ids: list[str], batch: int = 50) -> list[dict]:
        out: list[dict] = []
        for i in range(0, len(pmc_ids), batch):
            ids = pmc_ids[i:i + batch]
            resp = self._get(f"{EUTILS}/efetch.fcgi", {"db": "pmc", "id": ",".join(ids), "retmode": "xml"})
            out.extend(parse_jats_metadata(resp.content))
        return out

    def fetch_fulltext_bioc(self, pmcid: str) -> dict:
        return self._get(BIOC_URL.format(pmcid=pmcid)).json()


def license_label(href: str, text: str = "") -> str:
    """把 JATS 授權連結轉成簡稱；辨識不出時回傳 unknown（不擷取內容）。"""
    h = (href or "").lower()
    if "publicdomain/zero" in h:
        return "CC0"
    if "creativecommons.org/licenses/" in h:
        kind = h.split("creativecommons.org/licenses/")[1].split("/")[0]
        return "CC " + kind.upper()
    t = (text or "").lower()
    if "creative commons attribution" in t and "noncommercial" not in t and "non-commercial" not in t:
        return "CC BY"
    return "unknown"


def _text(el) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def parse_jats_metadata(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    rows = []
    for art in root.iter("article"):
        meta = art.find("front/article-meta")
        if meta is None:
            continue
        ids = {e.get("pub-id-type"): (e.text or "").strip() for e in meta.findall("article-id")}
        pmc = ids.get("pmcid") or ids.get("pmc") or ids.get("pmcaid") or ""
        if not pmc:
            continue
        pmcid = pmc if pmc.upper().startswith("PMC") else f"PMC{pmc}"
        surname = meta.find("contrib-group/contrib[@contrib-type='author']/name/surname")
        year = next((y.text for y in meta.iter("year") if y.text and y.text.strip().isdigit()), None)
        lic = meta.find("permissions/license")
        href = ""
        if lic is not None:
            href = lic.get(XLINK) or ""
            if not href:
                ref = next((e for e in lic.iter() if e.tag.endswith("license_ref")), None)
                href = (ref.text or "").strip() if ref is not None else ""
        journal = art.find("front/journal-meta/journal-title-group/journal-title")
        if journal is None:
            journal = art.find("front/journal-meta/journal-title")
        rows.append({
            "pmcid": pmcid,
            "pmid": ids.get("pmid"),
            "doi": ids.get("doi"),
            "title": _text(meta.find("title-group/article-title")),
            "first_author": _text(surname) or None,
            "year": int(year) if year else None,
            "journal": _text(journal) or None,
            "license": license_label(href, _text(lic)),
            "url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/",
        })
    return rows


KEEP_SECTIONS = {"TITLE", "ABSTRACT", "METHODS", "RESULTS"}


def bioc_to_text(doc: dict, max_chars: int = 60000) -> str:
    """只保留標題、摘要、方法、結果（PIS「送給 AI 的內容」）。"""
    docs = doc if isinstance(doc, list) else [doc]
    parts = []
    for collection in docs:
        for d in collection.get("documents", []):
            for p in d.get("passages", []):
                section = (p.get("infons", {}) or {}).get("section_type", "").upper()
                if section in KEEP_SECTIONS and p.get("text"):
                    parts.append(f"[{section}] {p['text']}")
    return "\n".join(parts)[:max_chars]
