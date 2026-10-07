// 組合詳情（PES S04～S06；FR-M2、FR-M3）與存為評估紀錄（FR-M4-01）

import { announcementsFor, claimInfo, ingredientEntry } from "./data.js";
import { lastResults, state as queryState } from "./search.js";
import { upsertRecord } from "./store.js";
import {
  DIRECTION, DISCLAIMER, FORM, INGREDIENT, LEVEL_DESC, PARTS, STUDY_TYPE,
  anatomy, h, healthFoodHint, levelChip, nowStr, outcomeText, processSummary, repoUrl, toast,
} from "./util.js";

const v = (x, unit = "") => (x == null || x === "" ? "文獻未載明" : `${x}${unit}`);

function extractionTag(f) {
  const e = f.extraction || {};
  return e.status === "reviewed"
    ? `<span class="tag ok">已複核（${h(e.reviewer)}，${h(String(e.reviewed_at || "").slice(0, 10))}）</span>`
    : e.source === "live"
      ? `<span class="tag auto">即時檢索（${h(e.model)}），未複核</span>`
      : `<span class="tag auto">自動擷取（${h(e.model)}），未複核</span>`;
}

// 每個欄位的顯示方式；同一篇的多個試驗組中，內容相同的欄位只顯示一次，不同的列入試驗組對照表
const FIELDS = [
  ["證據等級", (f) => `${levelChip(f.level)} ${h(STUDY_TYPE[f.study_type] || f.study_type)}`],
  ["對象", (f) => `${h(v(f.subjects?.population))}${f.subjects?.n != null ? `，${f.subjects.n} 人／隻` : ""}`],
  ["劑量", (f) => (f.dose?.amount != null ? h(`${f.dose.amount} ${f.dose.unit || ""} ${f.dose.frequency || ""}`) : "文獻未載明")],
  ["期間", (f) => h(v(f.duration_days, " 天"))],
  ["產品型態", (f) => h(FORM[f.product_form] || "文獻未載明")],
  ["指標", (f, d) => h(outcomeText(f.outcomes, claimInfo(d, f.health_claim)?.outcomes) || "文獻未載明")],
  ["結果", (f) => `<strong>${h(DIRECTION[f.result_direction])}</strong>：${h(f.summary_zh)}`],
  ["資料來源", (f) => extractionTag(f)],
];

function findingsHtml(d, fs) {
  const F = FIELDS.map(([l, r]) => [l, (f) => r(f, d)]);
  if (fs.length === 1) return `<dl>${F.map(([l, r]) => `<dt>${l}</dt><dd>${r(fs[0])}</dd>`).join("")}</dl>`;
  const same = F.filter(([, r]) => fs.every((f) => r(f) === r(fs[0])));
  const diff = F.filter((x) => !same.includes(x));
  return `<p class="small muted" style="margin:.5rem 0 0">本篇有 ${fs.length} 個試驗組，計分時算作 1 篇文獻。</p>
    <dl>${same.map(([l, r]) => `<dt>${l}</dt><dd>${r(fs[0])}</dd>`).join("")}</dl>
    <div class="table-wrap" style="margin-top:.5rem"><table class="data"><thead><tr><th>試驗組</th>${diff.map(([l]) => `<th>${l}</th>`).join("")}</tr></thead>
    <tbody>${fs.map((f, i) => `<tr><td class="num">${i + 1}</td>${diff.map(([, r]) => `<td>${r(f)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function articleBlock(d, pmcid, fs) {
  const a = d.articles[pmcid] || {};
  const repo = repoUrl();
  const issue = repo ? `${repo}/issues/new?title=${encodeURIComponent(`資料錯誤回報 ${pmcid}`)}&body=${encodeURIComponent(`文獻：${pmcid}\n錯誤欄位：\n正確內容：\n`)}` : null;
  const known = a.license && a.license !== "unknown";
  return `<article class="article">
    <h4>${h(a.title || pmcid)}</h4>
    <div class="small muted">${h(a.first_author || "")}${a.year ? `，${a.year}` : ""}${a.journal ? `，${h(a.journal)}` : ""}　${h(pmcid)}　授權：${h(known ? a.license : "不明")}</div>
    ${known ? findingsHtml(d, fs) : `<p class="small">授權不明，僅提供連結。</p>`}
    <div class="actions"><a class="btn quiet" href="${h(a.url || `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`)}" target="_blank" rel="noopener">開啟原文</a>
      ${issue ? `<a class="btn quiet" href="${h(issue)}" target="_blank" rel="noopener">回報資料錯誤</a>` : ""}</div>
  </article>`;
}

export function regulationHtml(d, combo, findings) {
  const claim = claimInfo(d, combo.health_claim) || {};
  const em = claim.evaluation_method || {};
  const ann = announcementsFor(d, combo.health_claim)[0];
  const laws = d.regs.laws || [];
  const org = ingredientEntry(d, combo.organism_name, "organism");
  const sub = ingredientEntry(d, combo.substrate, "substrate");
  const ingRow = (label, name, e) => `<tr><td>${label}</td><td>${h(name)}</td><td>${h(INGREDIENT[e?.status || "confirm"])}</td><td>${e?.checked_at ? h(e.checked_at) : "未查核"}</td></tr>`;
  const recheck = (x) => (x.needs_recheck ? `<span class="tag auto">需重新查核</span>` : "");
  return `
  ${ann ? `<div class="notice warn small"><strong>法規有更新</strong>：${h(ann.date)} ${h(ann.title)}。<a href="${h(ann.url)}" target="_blank" rel="noopener">公告來源</a></div>` : ""}
  <div class="paths">
    <div class="panel"><h3 style="margin-top:0">以一般食品上市</h3>
      <p>不得宣稱${h(claim.name_zh || "")}等保健功效或醫療效能，訴求應放在原料、風味或製程特色。</p>
      <ul class="small">${laws.map((l) => `<li>${h(l.name_zh)}${l.relevant_articles && l.relevant_articles !== "待填" ? `（${h(l.relevant_articles)}）` : ""} ${recheck(l)}</li>`).join("")}</ul></div>
    <div class="panel"><h3 style="margin-top:0">申請健康食品</h3>
      <p>評估方法：${em.url ? `<a href="${h(em.url)}" target="_blank" rel="noopener">${h(em.name)}</a>` : h(em.name || "未設定")}${em.announced ? `（${h(em.announced)} 公告）` : ""}</p>
      <p>試驗要求：${em.requirements && em.requirements !== "待填" ? h(em.requirements) : "尚待維護人員依公告附件填寫"}</p>
      <p><strong>${h(healthFoodHint(combo.top_level, claim.human_trial_required))}</strong>。${h(claim.evidence_note || (claim.human_trial_required === true || claim.human_trial_required === false ? "" : "此功效的評估方法試驗要求尚待維護人員查證。"))}</p>
      ${recheck(claim)}</div>
  </div>
  <h3>原料可用性</h3>
  <div class="table-wrap"><table class="data"><thead><tr><th>類別</th><th>名稱</th><th>可用性</th><th>查核日期</th></tr></thead>
  <tbody>${ingRow("菌種", combo.organism_name, org)}${ingRow("原料", combo.substrate, sub)}</tbody></table></div>
  ${combo.ingredient_status !== "available" ? `<p class="small muted">未列於可供食品使用原料清單者標示「需確認」，請向法規人員確認。</p>` : ""}`;
}

export function renderCombo(root, d, comboId) {
  const c = d.comboById[comboId];
  if (!c) { root.innerHTML = `<div class="empty"><p>找不到這個組合，可能資料已更新。</p><a class="btn" href="#query">回到查詢</a></div>`; return; }
  const fs = c.findings.map((id) => d.findingById[id]).filter(Boolean);
  const byArticle = {};
  fs.forEach((f) => (byArticle[f.pmcid] ??= []).push(f));
  const order = Object.keys(byArticle).sort((a, b) =>
    (byArticle[a][0].level).localeCompare(byArticle[b][0].level) || (d.articles[b]?.year || 0) - (d.articles[a]?.year || 0));

  root.innerHTML = `
  <p><a href="#query">← 回到組合清單</a></p>
  <div class="detail-head">
    <div><h2><span class="latin">${h(c.organism_name)}</span> × ${h(c.substrate)}</h2>
      <p class="small muted">${DISCLAIMER}</p>
      <p>最高證據 ${levelChip(c.top_level)}（${h(LEVEL_DESC[c.top_level])}），共 <span class="num">${c.n_articles}</span> 篇；
        各等級：${["A", "B", "C", "D"].map((lv) => `${lv} ${c.counts_by_level[lv] || 0}`).join("、")}。製程：${h(processSummary(fs))}。</p>
      <div class="actions"><button class="btn" id="save-rec">存為評估紀錄</button></div></div>
    <div class="panel"><div class="score-num num">${c.score} <small>/ 100</small></div>${anatomy(c.score_parts, true)}
      <table class="parts-table"><tbody>${PARTS.map(([k, l]) => `<tr><td><span style="display:inline-block;width:.7rem;height:.7rem;background:var(--p-${k});margin-right:.35rem"></span>${l}</td><td class="num">${c.score_parts[k]}</td></tr>`).join("")}</tbody></table></div>
  </div>
  <h3>支持文獻</h3>
  ${order.map((p) => articleBlock(d, p, byArticle[p])).join("")}
  <h3>法規路徑</h3>
  ${regulationHtml(d, c, fs)}
  <dialog id="dlg-save"><form method="dialog">
    <h2>存為評估紀錄</h2>
    <p class="small muted">紀錄存在這台電腦的瀏覽器中，換電腦或清除瀏覽器資料會消失，請定期到「我的紀錄」匯出備份。</p>
    <div class="field"><label for="r-title">題目名稱</label><input type="text" id="r-title" required></div>
    <div class="field"><label for="r-opinion">評估人意見</label><textarea id="r-opinion" placeholder="為什麼選這個組合"></textarea></div>
    <div class="actions"><button class="btn" value="ok">儲存</button><button class="btn quiet" value="cancel" formnovalidate>取消</button></div>
  </form></dialog>`;

  const dlg = root.querySelector("#dlg-save");
  root.querySelector("#save-rec").addEventListener("click", () => {
    dlg.querySelector("#r-title").value = `以 ${c.organism_name} 發酵 ${c.substrate} 開發${claimInfo(d, c.health_claim)?.name_zh || ""}產品`;
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    const rec = snapshot(d, c, fs, dlg.querySelector("#r-title").value.trim(), dlg.querySelector("#r-opinion").value.trim());
    upsertRecord(rec);
    toast("已存為評估紀錄");
  });
}

// FR-M4-05：紀錄保存查詢當時的資料快照，資料更新後仍可重現原結果
function snapshot(d, c, fs, title, opinion) {
  const ranked = (lastResults.length ? lastResults : d.combos.filter((x) => x.health_claim === c.health_claim)).slice(0, 10);
  const top = ranked.map((x, i) => ({
    rank: i + 1, combo_id: x.combo_id, organism_name: x.organism_name, substrate: x.substrate,
    top_level: x.top_level, n_articles: x.n_articles, score: x.score, score_parts: x.score_parts,
    positive_ratio: x.positive_ratio, ingredient_status: x.ingredient_status,
    process: processSummary(x.findings.map((id) => d.findingById[id]).filter(Boolean)),
  }));
  const pmcids = [...new Set(fs.map((f) => f.pmcid))];
  const claim = claimInfo(d, c.health_claim);
  return {
    id: `r${Date.now().toString(36)}`, created_at: nowStr(), title: title || "未命名題目", opinion,
    data_version: d.meta.data_version,
    conditions: { claim: c.health_claim, claim_name: claim?.name_zh, form: queryState.form, prefer: queryState.prefer,
                  exclude: queryState.exclude, levels: queryState.levels, n_matched: lastResults.length || ranked.length },
    combo: { ...c, process: processSummary(fs) }, findings: fs,
    articles: Object.fromEntries(pmcids.map((p) => [p, d.articles[p] || { pmcid: p }])),
    top10: top,
    regulations: {
      evaluation_method: claim?.evaluation_method, claim_checked_at: claim?.checked_at,
      outcomes: claim?.outcomes || [], human_trial_required: claim?.human_trial_required ?? null,
      evidence_note: claim?.evidence_note || null,
      laws: d.regs.laws, announcements: announcementsFor(d, c.health_claim),
      organism: ingredientEntry(d, c.organism_name, "organism") || null,
      substrate: ingredientEntry(d, c.substrate, "substrate") || null,
    },
    report_inputs: {},
  };
}
