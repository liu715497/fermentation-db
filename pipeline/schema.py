"""Finding 資料格式（PIS「資料模型」）。AI 輸出與 raw 檔都用此格式檢核。"""

from pipeline.evidence import STUDY_TYPE_LEVEL

_nullable_str = {"type": ["string", "null"]}
_nullable_num = {"type": ["number", "null"]}

# AI 回傳的單筆內容（不含 finding_id、health_claim、extraction，這三欄由程式補上）
AI_FINDING = {
    "type": "object",
    "required": ["is_fermented"],
    "properties": {
        "is_fermented": {"type": "boolean"},
        "exclude_reason": {"type": ["string", "null"]},   # 不符合範圍時的原因，供人工判斷擷取指示是否太嚴
        "organism": {
            "type": "object",
            "required": ["genus", "species"],
            "properties": {"genus": _nullable_str, "species": _nullable_str, "strain": _nullable_str},
        },
        "substrate": _nullable_str,
        "fermentation": {
            "type": ["object", "null"],
            "properties": {"temperature_c": _nullable_num, "duration_h": _nullable_num, "other": _nullable_str},
        },
        "product_form": {"enum": ["beverage", "powder", "tablet", "capsule", "other", None]},
        "study_type": {"enum": sorted(STUDY_TYPE_LEVEL)},
        "subjects": {
            "type": ["object", "null"],
            "properties": {"population": _nullable_str, "n": {"type": ["integer", "null"]}},
        },
        "dose": {
            "type": ["object", "null"],
            "properties": {"amount": _nullable_num, "unit": _nullable_str, "frequency": _nullable_str},
        },
        "duration_days": {"type": ["integer", "null"]},
        # 指標代碼由各保健功效在 health_claims.yaml 定義；是否屬於該功效由 extract 與 validate 檢查
        "outcomes": {"type": "array", "items": {"type": "string", "pattern": "^[a-z0-9_]+$"}},
        "result_direction": {"enum": ["positive", "null", "negative"]},
        "summary_zh": {"type": "string", "maxLength": 60},
    },
    # 發酵產品才要求完整欄位；非發酵者只需 is_fermented: false
    "if": {"properties": {"is_fermented": {"const": True}}},
    "then": {"required": ["organism", "substrate", "study_type", "outcomes", "result_direction", "summary_zh"]},
}

AI_RESPONSE = {
    "type": "object",
    "required": ["findings"],
    "properties": {"findings": {"type": "array", "items": AI_FINDING}},
}

EXTRACTION = {
    "type": "object",
    "required": ["provider", "model", "extracted_at", "extractor", "status"],
    "properties": {
        "provider": {"type": "string"},
        "model": {"type": "string"},
        "extracted_at": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$"},
        "extractor": {"type": "string"},
        "status": {"enum": ["auto", "reviewed"]},
        "reviewer": _nullable_str,
        "reviewed_at": _nullable_str,
    },
}

RAW_FILE = {
    "type": "object",
    "required": ["pmcid", "findings"],
    "properties": {
        "pmcid": {"type": "string", "pattern": r"^PMC\d+$"},
        "findings": {
            "type": "array",
            "items": {
                "allOf": [
                    AI_FINDING,
                    {
                        "type": "object",
                        "required": ["finding_id", "health_claim", "extraction"],
                        "properties": {
                            "finding_id": {"type": "string", "pattern": r"^PMC\d+-\d+$"},
                            "health_claim": {"type": "string"},
                            "extraction": EXTRACTION,
                        },
                    },
                ]
            },
        },
    },
}
