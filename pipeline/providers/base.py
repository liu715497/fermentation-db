"""AI 轉接層共用介面。各服務只負責「送出文字、取回文字」，格式檢核由 extract 處理。"""

from __future__ import annotations

import time

import requests


class ProviderError(RuntimeError):
    """AI 服務回傳錯誤（金鑰錯誤、額度用完、模型不存在等）。"""


class Provider:
    name = "base"

    def __init__(self, model: str, api_key: str = "", base_url: str = "",
                 max_tokens: int = 4096, temperature: float | None = 0.0, timeout: int = 180):
        if not model:
            raise ProviderError("未設定 AI_MODEL")
        self.model = model
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.timeout = timeout

    def complete(self, system: str, messages: list[dict]) -> str:
        """messages 為 [{"role": "user"|"assistant", "content": str}, ...]。"""
        raise NotImplementedError

    def _post(self, url: str, headers: dict, payload: dict) -> dict:
        last = None
        for attempt in range(3):
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=self.timeout)
            except requests.RequestException as exc:
                last = exc
                time.sleep(2 ** attempt)
                continue
            if resp.status_code in (429, 500, 502, 503, 529):  # 暫時性錯誤才重試
                last = ProviderError(f"{self.name} 暫時無法服務（HTTP {resp.status_code}）")
                time.sleep(2 ** attempt * 2)
                continue
            if resp.status_code in (401, 403):
                raise ProviderError(f"{self.name} 拒絕連線，請檢查金鑰或額度（HTTP {resp.status_code}）")
            if resp.status_code >= 400:
                raise ProviderError(f"{self.name} 回傳錯誤 HTTP {resp.status_code}：{resp.text[:300]}")
            return resp.json()
        raise ProviderError(f"{self.name} 連線失敗：{last}")
