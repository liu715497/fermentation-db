// 報告分頁（PES S09；FR-M4-03）：填寫【】欄位、AI 草擬、摘要報告列印、正式報告 Word 草稿

import { complete, isConfigured } from "./ai.js";
import { getRecord, listRecords, upsertRecord } from "./store.js";
import { DIRECTION, DISCLAIMER, FORM, INGREDIENT, LEVEL_DESC, STUDY_TYPE, h, healthFoodHint, levelChip, nowStr, outcomeText, recordRegs, toast } from "./util.js";

const FIELDS = [
  ["evaluator", "評估人（姓名、單位）", "text"],
  ["conclusion", "評估結論（3 句以內：是否建議立案、選定組合、主要依據）", "area", true],
  ["risk_evidence", "主要風險：證據缺口（1～2 點）", "area", true],
  ["risk_regulatory", "主要風險：法規限制（1～2 點）", "area", true],
  ["selection_reason", "選定理由（若非第 1 名請說明）", "area"],
  ["inconsistency_note", "結果不一致的原因判斷", "area", true],
  ["general_food_approach", "以一般食品上市的可行訴求", "area"],
  ["hf_support", "現有證據可否支持健康食品申請（可／部分／否，並說明）", "area"],
  ["extra_trials", "需補做的試驗", "area"],
  ["gaps", "證據缺口與建議試驗（一行一項：缺口；影響；建議試驗；優先順序）", "area", true],
  ["other_risks", "其他風險（例：菌株專利、原料供應）", "area"],
  ["reviewer", "審核人（姓名、職稱）", "text"],
];

export function renderReport(root, d, recordId) {
  if (!recordId) {
    const rs = listRecords();
    root.innerHTML = `<h2>報告</h2>${rs.length ? `<p>選擇要產出報告的評估紀錄：</p><ul>${rs.map((r) =>
      `<li><a href="#report/${h(r.id)}">${h(r.title)}</a> <span class="small muted">${h(r.created_at)}</span></li>`).join("")}</ul>`
      : `<div class="empty"><p><strong>還沒有評估紀錄</strong></p><p class="muted">報告由評估紀錄產生，請先在組合詳情按「存為評估紀錄」。</p><a class="btn" href="#query">開始查詢</a></div>`}`;
    return;
  }
  const rec = getRecord(recordId);
  if (!rec) { root.innerHTML = `<div class="empty"><p>找不到這筆紀錄。</p><a class="btn" href="#records">回到我的紀錄</a></div>`; return; }
  const inp = rec.report_inputs || {};

  root.innerHTML = `
  <p><a href="#records">← 回到我的紀錄</a></p>
  <h2>${h(rec.title)}</h2>
  <p class="small muted">資料快照 ${h(rec.data_version)}，建立於 ${h(rec.created_at)}。報告內容取自建立紀錄當時的資料。</p>
  <div class="panel">
    <h3 style="margin-top:0">評估人填寫欄位</h3>
    <p class="small muted">對應報告中的【】欄位，輸入即自動儲存。可按「AI 草擬」先產生標示 ★ 欄位的草稿，再自行修改。</p>
    <form id="rep-form">${FIELDS.map(([k, label, type, ai]) => `
      <div class="field"><label for="f-${k}">${h(label)}${ai ? " ★" : ""}</label>
      ${type === "text" ? `<input type="text" id="f-${k}" name="${k}">` : `<textarea id="f-${k}" name="${k}"></textarea>`}</div>`).join("")}
    </form>
    <div class="actions">
      <button class="btn secondary" id="btn-ai">AI 草擬 ★ 欄位</button>
      <button class="btn" id="btn-pdf">列印摘要報告（PDF）</button>
      <button class="btn" id="btn-docx">下載正式報告草稿（Word）</button>
    </div>
    <p id="rep-status" class="small" role="status"></p>
  </div>
  <h3>摘要報告預覽</h3>
  <div id="preview"></div>
  <dialog id="dlg-ai"><h2>確認送出內容</h2>
    <p class="small">以下內容將送到你在「設定」選的 AI 服務。請確認沒有委託案或未公開資料。</p>
    <pre class="payload" id="ai-payload"></pre>
    <div class="actions"><button class="btn" id="ai-go">送出並草擬</button><button class="btn quiet" id="ai-cancel">取消</button></div></dialog>`;

  const form = root.querySelector("#rep-form");
  FIELDS.forEach(([k]) => { form.elements[k].value = inp[k] || ""; });
  const preview = () => { root.querySelector("#preview").innerHTML = summaryHtml(rec, rec.report_inputs || {}); };
  form.addEventListener("input", () => {
    rec.report_inputs = Object.fromEntries(FIELDS.map(([k]) => [k, form.elements[k].value]));
    upsertRecord(rec); preview();
  });
  preview();

  const status = root.querySelector("#rep-status");
  root.querySelector("#btn-pdf").addEventListener("click", () => {
    const pr = document.getElementById("print-root");
    pr.innerHTML = summaryHtml(rec, rec.report_inputs || {});
    window.print();
  });
  root.querySelector("#btn-docx").addEventListener("click", async () => {
    status.textContent = "產生 Word 檔中…";
    try {
      const { buildFormalReport } = await import("./docx-report.js");
      const name = await buildFormalReport(rec, rec.report_inputs || {});
      status.textContent = `已下載 ${name}`;
    } catch (err) { status.textContent = `產生失敗：${err.message}`; }
  });

  const dlg = root.querySelector("#dlg-ai");
  root.querySelector("#btn-ai").addEventListener("click", () => {
    if (!isConfigured()) { status.innerHTML = `尚未設定 AI，請先到<a href="#settings">設定</a>填寫。`; return; }
    root.querySelector("#ai-payload").textContent = JSON.stringify(aiPayload(rec), null, 2);
    dlg.showModal();
  });
  root.querySelector("#ai-cancel").addEventListener("click", () => dlg.close());
  root.querySelector("#ai-go").addEventListener("click", async () => {
    dlg.close(); status.textContent = "AI 草擬中…";
    try {
      const out = await complete(AI_SYSTEM, JSON.stringify(aiPayload(rec)));
      const draft = JSON.parse(out.replace(/^\s*```(?:json)?|```\s*$/g, ""));
      for (const k of ["conclusion", "risk_evidence", "risk_regulatory", "inconsistency_note", "gaps"]) {
        if (typeof draft[k] === "string" && !form.elements[k].value.trim()) form.elements[k].value = draft[k];
      }
      form.dispatchEvent(new Event("input"));
      status.textContent = "已填入草稿（只填入空白欄位），請逐項確認修改。";
    } catch (err) { status.textContent = err instanceof SyntaxError ? "AI 回覆格式無法辨識，請再試一次。" : err.message; }
  });
}

const AI_SYSTEM = `你是食品研發評估助理，協助草擬發酵產品研發題目評估報告。依使用者提供的文獻整理資料撰寫，不得加入資料以外的事實或數字。
只輸出 JSON：{"conclusion": "", "risk_evidence": "", "risk_regulatory": "", "inconsistency_note": "", "gaps": ""}
規則：繁體中文；conclusion 3 句以內；gaps 一行一項，格式「缺口；影響；建議試驗；高/中/低」；判斷健康食品可行性時，依資料中「評估方法說明」與「最新法規公告」；不得寫成療效或功效保證。`;

function aiPayload(rec) {
  return {
    題目: rec.title, 保健功效: rec.conditions.claim_name,
    組合: `${rec.combo.organism_name} × ${rec.combo.substrate}`,
    綜合分數: rec.combo.score, 分項: rec.combo.score_parts, 各等級篇數: rec.combo.counts_by_level,
    原料可用性: INGREDIENT[rec.combo.ingredient_status],
    健康食品評估方法: rec.regulations.evaluation_method?.name,
    評估方法說明: rec.regulations.evidence_note || "未提供",
    最新法規公告: (rec.regulations.announcements || [])[0]?.summary || "無",
    文獻: rec.findings.map((f) => ({ 年份: f.year, 試驗類型: STUDY_TYPE[f.study_type], 等級: f.level,
      對象: f.subjects, 指標: outcomeText(f.outcomes, recordRegs(rec).outcomes), 劑量: f.dose, 期間天數: f.duration_days, 結果: DIRECTION[f.result_direction], 摘要: f.summary_zh })),
    評估人意見: rec.opinion || "",
  };
}

const fill = (v, ph = "（未填寫）") => (v && v.trim() ? h(v.trim()).replace(/\n/g, "<br>") : `<span style="color:#999">${ph}</span>`);

export function summaryHtml(rec, inp) {
  const c = rec.conditions;
  return `<div class="report-sheet">
    <div style="display:flex;justify-content:space-between;font-size:.75rem;color:#555"><span>測試版</span><span>資料分級：內部</span></div>
    <h1>發酵研發題目評估摘要</h1>
    <table><tbody>
      <tr><th style="width:18%">題目名稱</th><td colspan="3">${h(rec.title)}</td></tr>
      <tr><th>評估日期</th><td>${h(rec.created_at.slice(0, 10))}</td><th style="width:18%">評估人</th><td>${fill(inp.evaluator)}</td></tr>
      <tr><th>資料版本</th><td colspan="3">${h(rec.data_version)}</td></tr>
      <tr><th>評估條件</th><td colspan="3">${h(c.claim_name)}；產品型態 ${h(c.form === "any" ? "不限" : FORM[c.form] || c.form)}；原料偏好 ${h(c.prefer || "無")}；排除 ${h(c.exclude || "無")}</td></tr>
    </tbody></table>
    <strong>前三名組合</strong>
    <table><thead><tr><th>名次</th><th>菌種</th><th>原料</th><th>製程</th><th>最高等級</th><th>篇數</th><th>分數</th><th>法規路徑</th></tr></thead><tbody>
      ${rec.top10.slice(0, 3).map((t) => `<tr${t.combo_id === rec.combo.combo_id ? ' style="font-weight:700"' : ""}><td>${t.rank}</td><td><i>${h(t.organism_name)}</i></td><td>${h(t.substrate)}</td><td>${h(t.process)}</td><td>${h(t.top_level)}</td><td>${t.n_articles}</td><td>${t.score}</td><td>${h(healthFoodHint(t.top_level, recordRegs(rec).human_trial_required))}</td></tr>`).join("")}
    </tbody></table>
    ${rec.top10.slice(0, 3).some((t) => t.combo_id === rec.combo.combo_id) ? "" : `<p style="font-size:.8125rem">選定組合：<i>${h(rec.combo.organism_name)}</i> × ${h(rec.combo.substrate)}（${rec.combo.score} 分）</p>`}
    <strong>評估人建議</strong><p>${fill(inp.conclusion)}</p>
    <strong>主要風險</strong>
    <p>證據缺口：${fill(inp.risk_evidence)}<br>法規限制：${fill(inp.risk_regulatory)}</p>
    <div class="foot">${DISCLAIMER} 本摘要僅供本所研發立案評估使用。產出時間 ${h(nowStr())}（UTC+8）。</div>
  </div>`;
}

export { FIELDS, LEVEL_DESC, levelChip };
