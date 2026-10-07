from pipeline.providers.base import Provider, ProviderError


class AnthropicProvider(Provider):
    name = "anthropic"
    default_url = "https://api.anthropic.com/v1/messages"

    def complete(self, system, messages):
        if not self.api_key:
            raise ProviderError("未設定 AI_API_KEY")
        payload = {"model": self.model, "max_tokens": self.max_tokens, "system": system, "messages": messages}
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        headers = {"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        data = self._post(self.base_url or self.default_url, headers, payload)
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
