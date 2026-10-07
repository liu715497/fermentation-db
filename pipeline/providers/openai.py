from pipeline.providers.base import Provider, ProviderError


class OpenAIProvider(Provider):
    """OpenAI 及相容 OpenAI Chat Completions 格式的服務（含地端模型）。"""

    name = "openai"
    default_base = "https://api.openai.com/v1"
    require_key = True

    def complete(self, system, messages):
        if self.require_key and not self.api_key:
            raise ProviderError("未設定 AI_API_KEY")
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_tokens": self.max_tokens,
        }
        # 部分新模型不接受 temperature；AI_TEMPERATURE 留空即不送
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        url = f"{self.base_url or self.default_base}/chat/completions"
        data = self._post(url, headers, payload)
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError) as exc:
            raise ProviderError(f"{self.name} 回應格式無法解析：{exc}") from exc


class OpenAICompatibleProvider(OpenAIProvider):
    name = "openai_compatible"
    require_key = False

    def complete(self, system, messages):
        if not self.base_url:
            raise ProviderError("openai_compatible 需設定 AI_BASE_URL，例如地端服務的 /v1 位址")
        return super().complete(system, messages)
