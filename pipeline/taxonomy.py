"""菌名正規化與組合代碼。"""

from __future__ import annotations

import re


def build_alias_map(alias_doc: dict | None) -> dict[str, str]:
    aliases = (alias_doc or {}).get("aliases", []) or []
    return {a["old"].strip().lower(): a["current"].strip() for a in aliases}


def canonical_name(genus: str | None, species: str | None, alias_map: dict[str, str]) -> str:
    name = " ".join(p.strip() for p in (genus or "", species or "") if p and p.strip())
    if not name:
        return "unknown"
    name = name[0].upper() + name[1:].lower()  # 學名慣例：屬名首字大寫、種名小寫
    return alias_map.get(name.lower(), name)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "unknown"


def combo_id(organism_name: str, substrate: str | None) -> str:
    return f"{slug(organism_name)}__{slug(substrate or 'unknown')}"
