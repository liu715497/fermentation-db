// 文獻檢索分頁：設定檢索參數、預覽篩選結果（不花 AI 費用）、執行即時檢索、繼續處理剩下的

import { PROVIDERS, getSettings, isConfigured } from "./ai.js";
import { claimInfo } from "./data.js";
import { buildTerm, clearLive, fetchAbstract, liveData, runLive, screen } from "./live.js";
import { h } from "./util.js";

let controller = null;
let lastScreen = null;          // 上次預覽的篩選結果
const picked = new Set();       // 預覽中勾選的 PMCID
const MAX_LIST = 200;
const P = { claim: null, mustAll: "", anyOf: "", exclude: "", yearFrom: "", yearTo: "", type: "any",
            minCited: "", minJournal: "", sort: "human", count: "10", advanced: "", useOpenAlex: true };
const SEC_PER_ARTICLE = 20;   // 每篇約 10～30 秒，取中間值估算

const TYPE = { any: "不限", no_review: "排除綜述", review: "只要綜述" };
const SORT = { human: "人體試驗優先", newest: "最新收錄", cited: "被引用數最高", journal: "期刊指標最高" };
const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("");
const params = () => ({ ...P, minCited: Number(P.minCited) || 0, minJournal: Number(P.minJournal) || 0,
                        yearFrom: P.yearFrom.trim(), yearTo: P.yearTo.trim() });
const est = (n) => { const m = Math.ceil((n * SEC_PER_ARTICLE) / 60); return m < 2 ? "約 1～2 分鐘" : `約 ${m} 分鐘`; };

export function renderLive(root, d) {
  const claims = d.regs.health_claims.filter((c) => c.enabled);
  P.claim ??= claims[0]?.code;
  const s = getSettings();
  const ready = isConfigured();
  root.innerHTML = `
  <h2>文獻檢索</h2>
  <p>從 PMC 開放取用文獻中挑出符合條件的研究，由你在「設定」選的 AI 逐篇整理，完成後即可在「查詢」看到組合排名。</p>
  <div class="notice warn small">每篇約需 10～30 秒並使用你的 AI 額度。結果只存在這台電腦的瀏覽器，標示「即時檢索、未複核」；用於正式評估前請人工核對原文。被引用數與期刊指標來自 OpenAlex，期刊指標是仿照 IF 計算的 2 年平均被引用數，不是 Clarivate 的 IF。</div>
  ${ready ? "" : `<div class="notice bad">尚未設定 AI，請先到<a href="#settings">設定</a>填寫並測試連線。可以先用「預覽篩選結果」看會挑到哪些文獻。</div>`}
  <form class="panel" id="live-form" style="max-width:52rem">
    <div class="field"><label for="l-claim">保健功效</label><select id="l-claim">${claims.map((c) => `<option value="${h(c.code)}">${h(c.name_zh)}</option>`).join("")}</select></div>
    <fieldset class="field" style="border:0;padding:0"><legend class="label" style="font-weight:600">關鍵字（選填，英文，多個用逗號分隔）</legend>
      <div class="grid3">
        <label>必須全部包含<input type="text" id="l-all" placeholder="例：soybean"></label>
        <label>包含任一即可<input type="text" id="l-any" placeholder="例：Lactobacillus, Bacillus"></label>
        <label>排除<input type="text" id="l-not" placeholder="例：mice, rat"></label>
      </div><div class="hint">片語直接輸入即可，例如 black rice。</div></fieldset>
    <div class="grid3">
      <div class="field"><label for="l-y1">發表年份（起）</label><input type="text" id="l-y1" inputmode="numeric" placeholder="例：2016"></div>
      <div class="field"><label for="l-y2">發表年份（迄）</label><input type="text" id="l-y2" inputmode="numeric" placeholder="例：2026"></div>
      <div class="field"><label for="l-type">文章類型</label><select id="l-type">${opt(TYPE, P.type)}</select></div>
      <div class="field"><label for="l-cit">最少被引用數</label><input type="text" id="l-cit" inputmode="numeric" placeholder="不限"></div>
      <div class="field"><label for="l-jr">期刊指標至少</label><input type="text" id="l-jr" inputmode="decimal" placeholder="不限"><div class="hint">期刊 2 年平均被引用數</div></div>
      <div class="field"><label for="l-sort">處理順序</label><select id="l-sort">${opt(SORT, P.sort)}</select></div>
    </div>
    <div class="field"><label for="l-n">直接處理時的篇數</label>
      <select id="l-n">${["5", "10", "20", "50", "all"].map((v) => `<option value="${v}"${v === P.count ? " selected" : ""}>${v === "all" ? "全部" : v}</option>`).join("")}</select>
      <div class="hint" id="l-est"></div></div>
    <details class="field"><summary>進階：自訂完整查詢式</summary>
      <p class="small muted">留空時依上方條件自動產生。填寫後會直接使用你的查詢式，上方的關鍵字與年份不再套用（文章類型、被引用數、期刊指標仍會篩選）。需包含 open access[filter] 才能取得全文。</p>
      <textarea id="l-adv" rows="4"></textarea>
      <button type="button" class="btn quiet" id="l-show">帶入目前條件產生的查詢式</button></details>
    <p class="small muted">使用 AI：${h(PROVIDERS[s.provider] || s.provider)}${s.model ? `／${h(s.model)}` : ""}</p>
    <div class="actions">
      <button type="button" class="btn" id="l-preview">預覽並勾選文獻（不花 AI 費用）</button>
      <button class="btn secondary" id="l-go" ${ready ? "" : "disabled"}>不預覽，直接依順序處理</button>
      <button type="button" class="btn quiet" id="l-stop" hidden>停止</button>
    </div>
  </form>
  <div id="l-prev"></div>
  <h3>進度</h3>
  <pre class="payload" id="l-log" aria-live="polite">尚未開始</pre>
  <div id="l-done"></div>
  <h3>本瀏覽器的檢索結果</h3>
  <div id="l-summary"></div>`;

  const $ = (id) => root.querySelector(id);
  const fields = { claim: "#l-claim", mustAll: "#l-all", anyOf: "#l-any", exclude: "#l-not", yearFrom: "#l-y1", yearTo: "#l-y2",
                   type: "#l-type", minCited: "#l-cit", minJournal: "#l-jr", sort: "#l-sort", count: "#l-n", advanced: "#l-adv" };
  Object.entries(fields).forEach(([k, sel]) => { $(sel).value = P[k] ?? ""; });
  const sync = () => {
    Object.entries(fields).forEach(([k, sel]) => { P[k] = $(sel).value; });
    $("#l-est").textContent = P.count === "all" ? "「全部」會處理篩選後的所有文獻，執行前會顯示篇數與預估時間。" : `預估 ${est(Number(P.count))}。已處理過的文獻會自動略過。`;
  };
  $("#live-form").addEventListener("input", sync); sync();
  $("#l-show").addEventListener("click", () => { $("#l-adv").value = buildTerm(claimInfo(d, P.claim), { ...params(), advanced: "" }); sync(); });

  const known = () => new Set(Object.keys(liveData().articles).concat(Object.keys(d.articles)));
  const log = $("#l-log");
  const say = (m) => { log.textContent = (log.textContent === "尚未開始" ? "" : log.textContent + "\n") + m; log.scrollTop = log.scrollHeight; };

  const summary = () => {
    const live = liveData(); const arts = Object.values(live.articles); const nArt = arts.length;
    const reviews = arts.filter((a) => a.work_type === "review").sort((a, b) => (b.cited_by_count ?? -1) - (a.cited_by_count ?? -1));
    $("#l-summary").innerHTML = `<p>${nArt ? `已檢索 <span class="num">${nArt}</span> 篇文獻，整理出 <span class="num">${live.findings.length}</span> 筆發酵相關結果。` : "尚無檢索結果。"}</p>
      ${reviews.length ? `<details><summary>綜述文獻 ${reviews.length} 篇（一般綜述不列入計分，可作為背景閱讀）</summary>
        <div class="table-wrap"><table class="data"><thead><tr><th>文獻</th><th>年份</th><th>被引用</th><th>期刊指標</th></tr></thead><tbody>
        ${reviews.map((a) => `<tr><td><a href="${h(a.url)}" target="_blank" rel="noopener">${h(a.title || a.pmcid)}</a></td><td class="num">${a.year ?? ""}</td><td class="num">${a.cited_by_count ?? "—"}</td><td class="num">${a.journal_2yr ?? "—"}</td></tr>`).join("")}
        </tbody></table></div></details>` : ""}
      ${nArt ? `<div class="actions"><a class="btn secondary" href="#query">到查詢看組合排名</a><button class="btn danger" id="l-clear">清除檢索結果</button></div>` : ""}`;
    $("#l-clear")?.addEventListener("click", () => { if (confirm("確定清除本瀏覽器的全部檢索結果？已存的評估紀錄不受影響。")) { clearLive(); summary(); } });
  };
  summary();

  // 預覽：列出篩選後的文獻供勾選，可展開摘要；只有勾選的才送 AI 分析
  const renderPreview = () => {
    const sc = lastScreen; if (!sc) return;
    const done = known();
    const rows = sc.eligible.slice(0, MAX_LIST);
    $("#l-prev").innerHTML = `<div class="panel" style="margin-top:1rem">
      <h3 style="margin-top:0">預覽：篩選後 ${sc.eligible.length} 篇</h3>
      <p class="small">PMC 共 ${sc.total} 篇符合查詢式；先前已處理 ${sc.done} 篇。${sc.notes.map(h).join("；")}</p>
      <p class="small muted">查詢式：${h(sc.term)}</p>
      ${rows.length ? `<p class="small">先看標題與摘要，勾選值得分析的文獻，只有勾選的會使用 AI 額度。</p>
      <div class="actions" style="margin-top:0">
        <button type="button" class="btn quiet" data-pick="all">全選</button>
        <button type="button" class="btn quiet" data-pick="none">全不選</button>
        <button type="button" class="btn quiet" data-pick="10">勾選前 10 篇</button>
      </div>
      <div class="table-wrap" style="margin-top:.5rem"><table class="data"><thead><tr><th>分析</th><th>順序</th><th>文獻</th><th>年份</th><th>類型</th><th>被引用</th><th>期刊指標</th><th>摘要</th></tr></thead><tbody>
      ${rows.map((r, i) => { const isDone = done.has(r.pmcid); return `<tr>
        <td><input type="checkbox" class="pick" value="${h(r.pmcid)}" ${isDone ? "disabled" : picked.has(r.pmcid) ? "checked" : ""} aria-label="勾選 ${h(r.title || r.pmcid)}"></td>
        <td class="num">${i + 1}</td>
        <td><a href="https://pmc.ncbi.nlm.nih.gov/articles/${h(r.pmcid)}/" target="_blank" rel="noopener">${h(r.title || r.pmcid)}</a>
          ${r.human ? ' <span class="tag ok">人體試驗用語</span>' : ""}${isDone ? ' <span class="tag">已分析</span>' : ""}
          ${r.journalName ? `<div class="small muted">${h(r.journalName)}</div>` : ""}</td>
        <td class="num">${r.year ?? ""}</td><td>${h(r.type || "—")}</td><td class="num">${r.cited ?? "—"}</td><td class="num">${r.journal ?? "—"}</td>
        <td><button type="button" class="btn quiet abs" data-i="${i}">看摘要</button></td></tr>
        <tr class="abs-row" id="abs-${i}" hidden><td></td><td colspan="7" class="small"></td></tr>`; }).join("")}
      </tbody></table></div>
      ${sc.eligible.length > MAX_LIST ? `<p class="small muted">只列前 ${MAX_LIST} 篇；可加上年份或關鍵字縮小範圍。</p>` : ""}
      <div class="actions"><button type="button" class="btn" id="l-sel" ${isConfigured() ? "" : "disabled"}></button><span class="small muted" id="l-sel-est"></span></div>` : ""}
    </div>`;
    const upd = () => {
      const n = picked.size; const b = $("#l-sel"); if (!b) return;
      b.textContent = `分析勾選的 ${n} 篇`; b.disabled = !n || !isConfigured();
      $("#l-sel-est").textContent = n ? `預估 ${est(n)}` : "尚未勾選";
    };
    root.querySelectorAll(".pick").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? picked.add(cb.value) : picked.delete(cb.value); upd(); }));
    root.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const boxes = [...root.querySelectorAll(".pick:not([disabled])")];
      boxes.forEach((cb, i) => { cb.checked = b.dataset.pick === "all" || (b.dataset.pick === "10" && i < 10); });
      picked.clear(); boxes.filter((cb) => cb.checked).forEach((cb) => picked.add(cb.value)); upd();
    }));
    root.querySelectorAll(".abs").forEach((b) => b.addEventListener("click", async () => {
      const tr = $(`#abs-${b.dataset.i}`); const cell = tr.lastElementChild;
      if (!tr.hidden) { tr.hidden = true; b.textContent = "看摘要"; return; }
      tr.hidden = false; b.textContent = "收合"; cell.textContent = "讀取中…";
      try { cell.textContent = await fetchAbstract(rows[Number(b.dataset.i)]); cell.style.whiteSpace = "pre-wrap"; }
      catch (err) { cell.textContent = `摘要讀取失敗：${err.message}`; }
    }));
    $("#l-sel")?.addEventListener("click", () => go(null, sc.eligible.filter((r) => picked.has(r.pmcid))));
    upd();
  };

  $("#l-preview").addEventListener("click", async () => {
    sync(); controller = new AbortController(); $("#l-prev").innerHTML = `<p class="small">篩選中…</p>`;
    try { lastScreen = await screen(claimInfo(d, P.claim), params(), known(), () => {}, controller.signal); picked.clear(); renderPreview(); }
    catch (err) { $("#l-prev").innerHTML = `<div class="notice bad">${h(err.message)}</div>`; }
    finally { controller = null; }
  });
  renderPreview();   // 切換分頁再回來時保留上次的預覽與勾選

  const go = async (e, selection = null) => {
    e?.preventDefault?.(); sync();
    const prompt = d.prompts?.[P.claim];
    if (!prompt) { say("缺少擷取指示檔，無法執行。"); return; }
    let count = P.count === "all" ? 500 : Number(P.count);
    controller = new AbortController();
    $("#l-go").disabled = true; $("#l-stop").hidden = false; log.textContent = "尚未開始"; $("#l-done").innerHTML = "";
    try {
      if (!selection && P.count === "all") {
        const sc = await screen(claimInfo(d, P.claim), params(), known(), () => {}, controller.signal);
        if (!confirm(`篩選後共 ${sc.eligible.length} 篇，預估 ${est(sc.eligible.length)}，並會使用相應的 AI 額度。確定全部處理？`)) { say("已取消。"); return; }
        count = sc.eligible.length;
      }
      const st = await runLive({ claim: claimInfo(d, P.claim), prompt, regs: d.regs, params: params(), count, knownIds: known(),
                                 provider: getSettings().provider, model: getSettings().model, onLog: say, signal: controller.signal, selection });
      if (selection) { selection.forEach((r) => picked.delete(r.pmcid)); renderPreview(); }
      say(`完成：整理 ${st.done} 篇，取得 ${st.findings} 筆發酵相關結果；非發酵 ${st.notFermented} 筆、授權不明 ${st.unknownLicense} 篇、失敗 ${st.failed} 篇。`);
      $("#l-done").innerHTML = `<div class="actions"><a class="btn" href="#query">到查詢看結果</a>
        ${st.remaining > 0 ? `<button type="button" class="btn secondary" id="l-more">繼續處理剩下的 ${st.remaining} 篇中的下一批</button>` : ""}</div>`;
      $("#l-more")?.addEventListener("click", () => go());
    } catch (err) {
      say(err.name === "AbortError" ? "已停止，已完成的文獻都已保存。" : `中止：${err.message}`);
    } finally {
      $("#l-go").disabled = !isConfigured(); $("#l-stop").hidden = true; controller = null; summary();
    }
  };
  $("#live-form").addEventListener("submit", go);
  $("#l-stop").addEventListener("click", () => controller?.abort());
}

export const isRunning = () => !!controller;
export const stopLive = () => controller?.abort();
