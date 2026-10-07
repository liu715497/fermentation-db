"""AI 轉接層：確認各服務的請求格式與回應解析（以假回應測試，不連外）。"""

import pytest

from pipeline import providers
from pipeline.providers.base import ProviderError


class Resp:
    def __init__(self, status, data):
        self.status_code, self._data, self.text = status, data, str(data)

    def json(self):
        return self._data


@pytest.fixture
def capture(monkeypatch):
    sent = {}

    def fake_post(url, headers, json, timeout):
        sent.update(url=url, headers=headers, json=json)
        return sent["reply"]

    monkeypatch.setattr("pipeline.providers.base.requests.post", fake_post)
    return sent


def make(name, **kw):
    env = {"AI_PROVIDER": name, "AI_MODEL": "m1", "AI_API_KEY": "k", **kw}
    return providers.from_env(env)


def test_anthropic(capture):
    capture["reply"] = Resp(200, {"content": [{"type": "text", "text": "ok"}]})
    assert make("anthropic").complete("sys", [{"role": "user", "content": "hi"}]) == "ok"
    assert capture["headers"]["x-api-key"] == "k" and capture["json"]["system"] == "sys"


def test_openai_omits_temperature_when_blank(capture):
    capture["reply"] = Resp(200, {"choices": [{"message": {"content": "ok"}}]})
    assert make("openai", AI_TEMPERATURE="").complete("sys", [{"role": "user", "content": "hi"}]) == "ok"
    assert "temperature" not in capture["json"] and capture["json"]["messages"][0]["role"] == "system"


def test_gemini(capture):
    capture["reply"] = Resp(200, {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]})
    assert make("gemini").complete("sys", [{"role": "user", "content": "hi"}]) == "ok"
    assert capture["url"].endswith("/models/m1:generateContent")


def test_local_model_needs_base_url_but_no_key(capture):
    capture["reply"] = Resp(200, {"choices": [{"message": {"content": "ok"}}]})
    p = make("openai_compatible", AI_API_KEY="", AI_BASE_URL="http://localhost:11434/v1")
    assert p.complete("s", [{"role": "user", "content": "x"}]) == "ok"
    assert "authorization" not in capture["headers"]
    with pytest.raises(ProviderError):
        make("openai_compatible", AI_BASE_URL="").complete("s", [])


def test_bad_key_raises_clear_error(capture):
    capture["reply"] = Resp(401, {"error": "invalid"})
    with pytest.raises(ProviderError, match="金鑰"):
        make("anthropic").complete("s", [{"role": "user", "content": "x"}])


def test_unknown_provider():
    with pytest.raises(ProviderError):
        providers.from_env({"AI_PROVIDER": "nope", "AI_MODEL": "m"})
