from pipeline.providers.base import Provider, ProviderError


class GeminiProvider(Provider):
    name = "gemini"
    default_base = "https://generativelanguage.googleapis.com/v1beta"

    def complete(self, system, messages):
        if not self.api_key:
            raise ProviderError("未設定 AI_API_KEY")
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
        ]
        gen = {"maxOutputTokens": self.max_tokens}
        if self.temperature is not None:
            gen["temperature"] = self.temperature
        payload = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents, "generationConfig": gen}
        headers = {"x-goog-api-key": self.api_key, "content-type": "application/json"}
        url = f"{self.base_url or self.default_base}/models/{self.model}:generateContent"
        data = self._post(url, headers, payload)
        try:
            parts = data["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError) as exc:
            raise ProviderError(f"gemini 回應格式無法解析：{exc}") from exc
        return "".join(p.get("text", "") for p in parts)
