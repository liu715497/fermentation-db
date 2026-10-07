// 設定分頁：AI 服務、模型、金鑰保存方式

import { PROVIDERS, clearKey, getKey, getSettings, saveSettings, testConnection } from "./ai.js";
import { getNcbi, saveNcbi, testPmc } from "./live.js";
import { h, toast } from "./util.js";

export function renderSettings(root, d) {
  const s = getSettings();
  root.innerHTML = `
  <h2>設定</h2>
  <div class="notice warn small">AI 用於「文獻檢索」整理文獻，以及報告的「AI 草擬」。送出的只有公開文獻內容與你填的文字；請不要在報告欄位中輸入委託案或未公開資料。</div>
  <form class="panel" id="ai-form" style="max-width:40rem">
    <div class="field"><label for="s-provider">AI 服務</label>
      <select id="s-provider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join("")}</select></div>
    <div class="field"><label for="s-model">模型名稱</label><input type="text" id="s-model" autocomplete="off" placeholder="例：gemini-3.5-flash-lite">
      <div class="hint">填 API 用的模型代碼（全小寫、以連字號連接），不是畫面上的顯示名稱。</div></div>
    <div class="field" id="f-base"><label for="s-base">服務位址</label><input type="text" id="s-base" placeholder="例：http://localhost:11434/v1"></div>
    <div class="field"><label for="s-key">金鑰</label><input type="password" id="s-key" autocomplete="off" placeholder="${getKey() ? "已設定（重新輸入可更換）" : "貼上你的金鑰"}">
      <div class="hint">金鑰只存在這個瀏覽器，不會上傳到本網站或 GitHub。</div></div>
    <div class="field"><label><input type="checkbox" id="s-remember"> 在這台電腦記住金鑰</label>
      <div class="hint">不勾選時，關閉分頁就清除金鑰（建議）。</div></div>
    <div class="actions">
      <button class="btn" id="s-save">儲存設定</button>
      <button type="button" class="btn secondary" id="s-test">測試連線</button>
      <button type="button" class="btn danger" id="s-clear">清除金鑰</button>
    </div>
    <p id="s-status" class="small" role="status"></p>
  </form>
  <h3>PMC 文獻來源</h3>
  <form class="panel" id="ncbi-form" style="max-width:40rem">
    <p class="small">「文獻檢索」直接連到 NCBI 的 PMC 查詢服務。以下兩欄都可留空；填寫聯絡信箱是 NCBI 建議的做法，API key 可提高查詢速度上限。</p>
    <div class="field"><label for="n-email">聯絡信箱（選填）</label><input type="text" id="n-email" autocomplete="email"></div>
    <div class="field"><label for="n-key">NCBI API key（選填）</label><input type="password" id="n-key" autocomplete="off"></div>
    <div class="actions"><button class="btn" id="n-save">儲存</button><button type="button" class="btn secondary" id="n-test">測試 PMC 連線</button></div>
    <p id="n-status" class="small" role="status"></p>
  </form>
  <h3>資料版本</h3>
  <p class="small">共用資料庫 ${h(d.meta.data_version)}，共 ${d.meta.n_articles} 篇；本瀏覽器即時檢索 ${d.liveCount} 篇。</p>`;

  const f = root.querySelector("#ai-form");
  const $ = (id) => f.querySelector(id);
  $("#s-provider").value = s.provider; $("#s-model").value = s.model; $("#s-base").value = s.baseUrl; $("#s-remember").checked = s.remember;
  const toggleBase = () => { $("#f-base").hidden = $("#s-provider").value !== "openai_compatible"; };
  toggleBase(); $("#s-provider").addEventListener("change", toggleBase);
  const collect = () => ({ provider: $("#s-provider").value, model: $("#s-model").value.trim(), baseUrl: $("#s-base").value.trim(), remember: $("#s-remember").checked });
  const save = () => saveSettings(collect(), $("#s-key").value.trim() || getKey());
  f.addEventListener("submit", (e) => { e.preventDefault(); save(); $("#s-key").value = ""; toast("已儲存設定"); renderSettings(root, d); });
  $("#s-test").addEventListener("click", async () => {
    save(); const st = $("#s-status"); st.textContent = "測試中…";
    try { const out = await testConnection(); st.textContent = `連線成功，AI 回覆：${out.trim().slice(0, 40)}`; }
    catch (err) { st.textContent = err.message; }
  });
  $("#s-clear").addEventListener("click", () => { clearKey(); toast("已清除金鑰"); renderSettings(root, d); });

  const nf = root.querySelector("#ncbi-form");
  const n = getNcbi();
  nf.querySelector("#n-email").value = n.email; nf.querySelector("#n-key").value = n.apiKey;
  const saveN = () => saveNcbi({ email: nf.querySelector("#n-email").value.trim(), apiKey: nf.querySelector("#n-key").value.trim() });
  nf.addEventListener("submit", (e) => { e.preventDefault(); saveN(); toast("已儲存"); });
  nf.querySelector("#n-test").addEventListener("click", async () => {
    saveN(); const st = nf.querySelector("#n-status"); st.textContent = "測試中…";
    try { const c = await testPmc(); st.textContent = `連線成功，PMC 開放取用中有 ${c.toLocaleString()} 篇含 fermented 的文獻。`; }
    catch (err) { st.textContent = err.message; }
  });
}
