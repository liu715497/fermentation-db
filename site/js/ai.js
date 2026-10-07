// 使用者自選 AI（SW Arch 流程 C）。金鑰只存在本瀏覽器；預設僅本次使用（sessionStorage）。

import { get, remove, set } from "./store.js";

const SETTINGS = "fdb.ai.settings";
const KEY = "fdb.ai.key";

export const PROVIDERS = {
  anthropic: "Claude（Anthropic）",
  openai: "OpenAI",
  gemini: "Google Gemini",
  openai_compatible: "地端模型或其他相容服務",
};

export const getSettings = () => get(SETTINGS) || { provider: "anthropic", model: "", baseUrl: "", remember: false };
export const getKey = () => get(KEY, "session") || get(KEY, "local") || "";
export function saveSettings(s, key) {
  set(SETTINGS, { provider: s.provider, model: s.model, baseUrl: s.baseUrl, remember: !!s.remember });
  remove(KEY);
  if (key) set(KEY, key, s.remember ? "local" : "session");
}
export const clearKey = () => remove(KEY);
export const isConfigured = () => { const s = getSettings(); return !!s.model && (s.provider === "openai_compatible" ? !!s.baseUrl : !!getKey()); };

async function post(url, headers, body) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
  catch {
    throw new Error("無法連線：此 AI 服務可能不允許瀏覽器直接呼叫，或網路不通。地端模型需開放跨來源存取（例如 Ollama 設定 OLLAMA_ORIGINS）。");
  }
  if (r.status === 401 || r.status === 403) throw new Error("AI 服務拒絕連線，請檢查金鑰或額度。");
  if (!r.ok) throw new Error(`AI 服務回傳錯誤 HTTP ${r.status}：${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function complete(system, user, maxTokens = 2000) {
  const s = getSettings(); const key = getKey();
  if (!s.model) throw new Error("請先到「設定」填寫模型名稱。");
  const msgs = [{ role: "user", content: user }];
  if (s.provider === "anthropic") {
    const d = await post("https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      { model: s.model, max_tokens: maxTokens, system, messages: msgs });
    return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  if (s.provider === "gemini") {
    const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`,
      { "x-goog-api-key": key },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } });
    return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  }
  const base = s.provider === "openai" ? "https://api.openai.com/v1" : s.baseUrl.replace(/\/+$/, "");
  if (!base) throw new Error("請先到「設定」填寫服務位址。");
  const d = await post(`${base}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {},
    { model: s.model, messages: [{ role: "system", content: system }, ...msgs], max_tokens: maxTokens });
  return d.choices?.[0]?.message?.content || "";
}

export const testConnection = () => complete("你是連線測試。", "請只回覆 OK", 16);
