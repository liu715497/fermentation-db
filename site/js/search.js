// 查詢分頁（PES S02、S03；FR-M1-01～06）

import { DISCLAIMER, FORM, INGREDIENT, anatomy, h, healthFoodHint, legendHtml, levelChip } from "./util.js";

export const state = { claim: null, form: "any", prefer: "", exclude: "", levels: ["A", "B", "C", "D"], sort: "score" };
export let lastResults = [];

const splitTerms = (s) => s.split(/[,，、;；\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);

export function filterCombos(d, st) {
  const prefer = st.prefer.trim().toLowerCase();
  const exclude = splitTerms(st.exclude);
  const allLevels = st.levels.length === 4;
  let rows = d.combos.filter((c) => {
    if (c.health_claim !== st.claim) return false;
    const sub = String(c.substrate || "").toLowerCase();
    if (prefer && !sub.includes(prefer)) return false;
    if (exclude.some((t) => sub.includes(t))) return false;
    if (!allLevels && !st.levels.some((lv) => (c.counts_by_level[lv] || 0) > 0)) return false;
    if (st.form !== "any" && !c.findings.some((id) => d.findingById[id]?.product_form === st.form)) return false;
    return true;
  });
  const key = { score: (c) => [-c.score, -c.n_articles, -c.latest_year],
                n: (c) => [-c.n_articles, -c.score, -c.latest_year],
                year: (c) => [-c.latest_year, -c.score, -c.n_articles] }[st.sort];
  rows = rows.slice().sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return rows;
}

function suggestions(st) {
  const s = [];
  if (st.prefer) s.push("清除「原料偏好」");
  if (st.exclude) s.push("減少「排除原料」");
  if (st.levels.length < 4) s.push("勾選更多證據等級");
  if (st.form !== "any") s.push("產品型態改為「不限」");
  return s.length ? `可以試著：${s.join("、")}。` : "目前資料庫尚無此保健功效的資料。";
}

export function renderQuery(root, d) {
  const claims = d.regs.health_claims.filter((c) => c.enabled);
  state.claim ??= claims[0]?.code;
  root.innerHTML = `
  <div class="layout-query">
    <details class="filters" id="q-details"><summary>查詢條件</summary><form class="panel" id="qform" aria-label="查詢條件">
      <div class="field"><label for="q-claim">保健功效</label>
        <select id="q-claim">${claims.map((c) => `<option value="${h(c.code)}">${h(c.name_zh)}</option>`).join("")}</select>
        <div class="hint">測試版只開放調節血糖</div></div>
      <div class="field"><label for="q-form">產品型態</label>
        <select id="q-form"><option value="any">不限</option>${Object.entries(FORM).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <div class="hint">依文獻中的產品型態篩選</div></div>
      <div class="field"><label for="q-prefer">原料偏好</label>
        <input type="text" id="q-prefer" placeholder="例：soybean"><div class="hint">原料名稱為英文，部分符合即可</div></div>
      <div class="field"><label for="q-exclude">排除原料</label>
        <input type="text" id="q-exclude" placeholder="例：milk, wheat"><div class="hint">多個請用逗號分隔</div></div>
      <fieldset class="field" style="border:0;padding:0;margin:0 0 .875rem"><legend class="label" style="font-weight:600">證據等級</legend>
        <div class="checks">${["A", "B", "C", "D"].map((lv) => `<label><input type="checkbox" name="lv" value="${lv}"> ${levelChip(lv)}</label>`).join("")}</div>
        <div class="hint">A、B 為人體試驗</div></fieldset>
      <div class="field"><label for="q-sort">排序</label>
        <select id="q-sort"><option value="score">綜合分數</option><option value="n">文獻篇數</option><option value="year">最新文獻</option></select></div>
      <button type="button" class="btn quiet" id="q-reset">重設條件</button>
    </form></details>
    <section aria-live="polite" id="q-results"></section>
  </div>`;

  // 窄螢幕預設收合條件，讓結果先出現在畫面上
  root.querySelector("#q-details").open = window.matchMedia("(min-width: 52rem)").matches;
  const f = root.querySelector("#qform");
  f.querySelector("#q-claim").value = state.claim;
  f.querySelector("#q-form").value = state.form;
  f.querySelector("#q-prefer").value = state.prefer;
  f.querySelector("#q-exclude").value = state.exclude;
  f.querySelector("#q-sort").value = state.sort;
  f.querySelectorAll("input[name=lv]").forEach((cb) => { cb.checked = state.levels.includes(cb.value); });

  const update = () => {
    state.claim = f.querySelector("#q-claim").value;
    state.form = f.querySelector("#q-form").value;
    state.prefer = f.querySelector("#q-prefer").value;
    state.exclude = f.querySelector("#q-exclude").value;
    state.sort = f.querySelector("#q-sort").value;
    state.levels = [...f.querySelectorAll("input[name=lv]:checked")].map((cb) => cb.value);
    renderResults(root.querySelector("#q-results"), d);
  };
  f.addEventListener("input", update);
  f.addEventListener("submit", (e) => e.preventDefault());
  f.querySelector("#q-reset").addEventListener("click", () => {
    Object.assign(state, { form: "any", prefer: "", exclude: "", levels: ["A", "B", "C", "D"], sort: "score" });
    renderQuery(root, d);
  });
  renderResults(root.querySelector("#q-results"), d);
}

function renderResults(el, d) {
  const rows = filterCombos(d, state);
  lastResults = rows;
  const head = `<div class="notice small">${DISCLAIMER}</div>`;
  if (!rows.length) {
    el.innerHTML = `${head}<div class="empty"><p><strong>目前資料庫無符合組合</strong></p><p class="muted">${h(suggestions(state))}</p></div>`;
    return;
  }
  el.innerHTML = `${head}
    <div class="results-head"><h2>${rows.length} 個組合</h2><span class="small muted">分數滿分 100，色條顯示分數組成</span></div>
    ${legendHtml()}
    <ol class="combos">${rows.map((c, i) => `
      <li><a class="row" href="#combo/${encodeURIComponent(c.combo_id)}">
        <span class="rank num">${i + 1}</span>
        <span><span class="combo-name"><span class="latin">${h(c.organism_name)}</span> × ${h(c.substrate)}</span>
          <span class="combo-meta"><span>最高 ${levelChip(c.top_level)}</span><span class="num">${c.n_articles} 篇</span>
          <span>原料${h(INGREDIENT[c.ingredient_status])}</span><span>${h(healthFoodHint(c.top_level))}</span></span></span>
        <span class="scorecell"><span class="score-num num">${c.score} <small>/ 100</small></span>${anatomy(c.score_parts)}</span>
      </a></li>`).join("")}</ol>`;
}
