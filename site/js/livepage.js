// 文獻檢索分頁：設定條件、執行即時檢索、查看與清除本瀏覽器的檢索結果

import { PROVIDERS, getSettings, isConfigured } from "./ai.js";
import { claimInfo } from "./data.js";
import { clearLive, liveData, runLive } from "./live.js";
import { h } from "./util.js";

let controller = null;

export function renderLive(root, d) {
  const claims = d.regs.health_claims.filter((c) => c.enabled);
  const s = getSettings();
  const ready = isConfigured();
  root.innerHTML = `
  <h2>文獻檢索</h2>
  <p>從 PMC 開放取用文獻中找出最新的研究，由你在「設定」選的 AI 逐篇整理出菌種、原料、試驗類型與結果，整理完即可在「查詢」看到組合排名。</p>
  <div class="notice warn small">每篇文獻約需 10～30 秒，並會使用你的 AI 額度。結果只存在這台電腦的瀏覽器，標示為「即時檢索、未複核」，不同人使用不同 AI 可能得到不同結果；用於正式評估前請人工核對原文。</div>
  ${ready ? "" : `<div class="notice bad">尚未設定 AI，請先到<a href="#settings">設定</a>填寫 AI 服務、模型與金鑰並測試連線。</div>`}
  ${d.prompts && Object.keys(d.prompts).length ? "" : `<div class="notice bad">網站缺少擷取指示檔（prompts.json），請更新倉庫的 pipeline 資料夾後重新部署。</div>`}
  <form class="panel" id="live-form" style="max-width:44rem">
    <div class="field"><label for="l-claim">保健功效</label>
      <select id="l-claim">${claims.map((c) => `<option value="${h(c.code)}">${h(c.name_zh)}</option>`).join("")}</select></div>
    <div class="field"><label for="l-kw">原料或菌種關鍵字（選填，英文）</label>
      <input type="text" id="l-kw" placeholder="例：soybean 或 Lactobacillus">
      <div class="hint">多個關鍵字用空白分隔，會同時符合。留空則找所有發酵相關文獻。</div></div>
    <div class="field"><label for="l-n">本次處理篇數</label>
      <select id="l-n"><option>5</option><option selected>10</option><option>20</option></select>
      <div class="hint">10 篇約需 3～5 分鐘。已檢索過的文獻會自動略過，可分次累積。</div></div>
    <p class="small muted">使用 AI：${h(PROVIDERS[s.provider] || s.provider)}${s.model ? `／${h(s.model)}` : ""}</p>
    <div class="actions">
      <button class="btn" id="l-go" ${ready ? "" : "disabled"}>開始檢索</button>
      <button type="button" class="btn quiet" id="l-stop" hidden>停止</button>
    </div>
  </form>
  <h3>進度</h3>
  <pre class="payload" id="l-log" aria-live="polite">尚未開始</pre>
  <div id="l-done"></div>
  <h3>本瀏覽器的檢索結果</h3>
  <div id="l-summary"></div>`;

  const $ = (id) => root.querySelector(id);
  const summary = () => {
    const live = liveData(); const nArt = Object.keys(live.articles).length;
    $("#l-summary").innerHTML = `<p>${nArt ? `已檢索 <span class="num">${nArt}</span> 篇文獻，整理出 <span class="num">${live.findings.length}</span> 筆發酵相關結果。` : "尚無檢索結果。"}</p>
      ${nArt ? `<div class="actions"><a class="btn secondary" href="#query">到查詢看組合排名</a><button class="btn danger" id="l-clear">清除檢索結果</button></div>` : ""}`;
    $("#l-clear")?.addEventListener("click", () => {
      if (confirm("確定清除本瀏覽器的全部檢索結果？已存的評估紀錄不受影響。")) { clearLive(); summary(); }
    });
  };
  summary();
  const log = $("#l-log");
  const say = (m) => { log.textContent = (log.textContent === "尚未開始" ? "" : log.textContent + "\n") + m; log.scrollTop = log.scrollHeight; };

  $("#live-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#l-claim").value;
    const prompt = d.prompts?.[code];
    if (!prompt) { say("缺少擷取指示檔，無法執行。"); return; }
    controller = new AbortController();
    $("#l-go").disabled = true; $("#l-stop").hidden = false; log.textContent = "尚未開始";
    const known = new Set([...Object.keys(d.articles)]);
    try {
      const st = await runLive({ claim: claimInfo(d, code), prompt, regs: d.regs, keyword: $("#l-kw").value,
        count: Number($("#l-n").value), knownIds: known, provider: s.provider, model: s.model, onLog: say, signal: controller.signal });
      say(`完成：整理 ${st.done} 篇，取得 ${st.findings} 筆發酵相關結果；非發酵 ${st.notFermented} 筆、授權不明 ${st.unknownLicense} 篇、失敗 ${st.failed} 篇。`);
      $("#l-done").innerHTML = `<div class="actions"><a class="btn" href="#query">到查詢看結果</a></div>`;
    } catch (err) {
      say(err.name === "AbortError" ? "已停止，已完成的文獻都已保存。" : `中止：${err.message}`);
    } finally {
      $("#l-go").disabled = false; $("#l-stop").hidden = true; controller = null;
      summary();
    }
  });
  $("#l-stop").addEventListener("click", () => controller?.abort());
}

export const isRunning = () => !!controller;
export const stopLive = () => controller?.abort();
