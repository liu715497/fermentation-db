"""依 .env 的 AI_PROVIDER 建立對應的轉接器。"""

from __future__ import annotations

from pipeline.providers.anthropic import AnthropicProvider
from pipeline.providers.base import Provider, ProviderError
from pipeline.providers.gemini import GeminiProvider
from pipeline.providers.openai import OpenAICompatibleProvider, OpenAIProvider

PROVIDERS = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "gemini": GeminiProvider,
    "openai_compatible": OpenAICompatibleProvider,
}


def from_env(env: dict[str, str]) -> Provider:
    name = env.get("AI_PROVIDER", "").strip()
    if name not in PROVIDERS:
        raise ProviderError(f"AI_PROVIDER 必須是 {', '.join(PROVIDERS)} 之一，目前為 {name!r}")
    temp_raw = env.get("AI_TEMPERATURE", "0").strip()
    return PROVIDERS[name](
        model=env.get("AI_MODEL", "").strip(),
        api_key=env.get("AI_API_KEY", "").strip(),
        base_url=env.get("AI_BASE_URL", "").strip(),
        max_tokens=int(env.get("AI_MAX_TOKENS", "4096") or 4096),
        temperature=float(temp_raw) if temp_raw else None,
    )


__all__ = ["PROVIDERS", "Provider", "ProviderError", "from_env"]
