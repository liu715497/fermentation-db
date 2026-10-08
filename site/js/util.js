// 共用工具：字串跳脫、時間（一律 UTC+8）、中文標籤、下載

export const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export const nowStr = () => fmt.format(new Date()).replace(",", "");      // YYYY-MM-DD hh:mm:ss
export const today = () => nowStr().slice(0, 10);
export const compactDate = () => today().replaceAll("-", "");

export const STUDY_TYPE = {
  meta_analysis: "統合分析", systematic_review: "系統性回顧", rct: "人體隨機對照試驗",
  non_rct_human: "人體非隨機試驗", observational: "觀察性研究", feeding_trial: "目標動物飼養試驗", animal: "其他動物試驗",
  in_vitro: "細胞或體外試驗", review: "綜述", opinion: "意見",
};
export const LEVEL_DESC = { A: "人體隨機對照、統合分析", B: "人體非隨機、觀察性", C: "動物試驗", D: "細胞或體外" };
// 動物飼料主題的等級意義不同：目標動物飼養試驗最強
export const LEVEL_DESC_ANIMAL = { A: "目標動物飼養試驗、統合分析", B: "其他動物試驗", C: "人體資料（間接參考）", D: "細胞或體外" };
export const levelDesc = (lv, target) => (target === "animal" ? LEVEL_DESC_ANIMAL : LEVEL_DESC)[lv];
export const TARGET = { human: "人類食品", animal: "動物飼料" };
// 評估指標名稱由各保健功效在 health_claims.yaml 的 outcomes 定義
export const outcomeText = (codes, outcomes) => {
  const names = Object.fromEntries((outcomes || []).map((o) => [o.code, o.name_zh]));
  return (codes || []).map((c) => names[c] || c).join("、");
};
export const DIRECTION = { positive: "支持", null: "無顯著差異", negative: "相反" };
export const INGREDIENT = { available: "可用", confirm: "需確認", unavailable: "不可用" };
export const FORM = { beverage: "飲品", powder: "粉末", tablet: "錠狀", capsule: "膠囊", other: "其他" };
export const PARTS = [
  ["evidence", "證據等級"], ["count", "文獻篇數"], ["consistency", "結果一致"],
  ["ingredient", "原料可用"], ["recency", "文獻新近"], ["citation", "被引用數"], ["journal", "期刊指標"],
];
export const DISCLAIMER = "本結果為公開文獻整理，部分由系統自動擷取，非功效保證或法規判定。";

export const levelChip = (lv) => `<span class="lv lv-${h(lv)}" title="${h(LEVEL_DESC[lv] || "不計分")}">${h(lv)}</span>`;

export function anatomy(parts, large = false) {
  const segs = PARTS.map(([k, label]) =>
    `<span class="${k}" style="width:${Math.max(0, parts[k] || 0)}%" title="${label} ${parts[k] ?? 0}"></span>`).join("");
  return `<div class="anatomy${large ? " large" : ""}" role="img" aria-label="${PARTS.map(([k, l]) => `${l} ${parts[k] ?? 0}`).join("，")}">${segs}</div>`;
}

export function legendHtml() {
  return `<div class="legend" aria-hidden="true">${PARTS.map(([k, l]) =>
    `<span><i style="background:var(--p-${k})"></i>${l}</span>`).join("")}</div>`;
}

// 健康食品路徑提示，依該功效評估方法是否只採人體試驗（health_claims.yaml human_trial_required）
export function healthFoodHint(top, humanTrialRequired, target = "human") {
  if (target === "animal") return "飼料：需符合飼料管理法公告品項";
  const human = top === "A" || top === "B";
  if (humanTrialRequired === true) return human ? "健康食品：已有人體證據" : "健康食品：需補人體試驗";
  if (humanTrialRequired === false) return human ? "健康食品：已有人體證據" : "健康食品：已有動物或細胞證據";
  return "健康食品：試驗要求待查證";
}

export function processSummary(findings) {
  const f = findings.find((x) => x.fermentation && (x.fermentation.temperature_c != null || x.fermentation.duration_h != null));
  if (!f) return "文獻未載明";
  const p = [];
  if (f.fermentation.temperature_c != null) p.push(`${f.fermentation.temperature_c} °C`);
  if (f.fermentation.duration_h != null) p.push(`${f.fermentation.duration_h} h`);
  return p.join("、");
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toast(msg) {
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: msg, role: "status" });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// 由 GitHub Pages 網址推得倉庫位置，用於「回報錯誤」；非 github.io 網域時回傳 null
export function repoUrl() {
  const host = location.hostname;
  if (!host.endsWith(".github.io")) return null;
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return repo ? `https://github.com/${host.split(".")[0]}/${repo}` : null;
}

// v0.4.0 以前存的評估紀錄沒有記錄功效設定（當時只有調節血糖），讀取時補上當時的設定
const LEGACY_GLYCEMIC = {
  target: "human", human_trial_required: true,
  outcomes: [["fpg", "空腹血糖"], ["hba1c", "糖化血色素"], ["ogtt_auc", "葡萄糖耐受曲線下面積"], ["homa_ir", "胰島素阻抗指數"],
             ["ppg", "餐後血糖"], ["insulin", "胰島素"], ["other", "其他"]].map(([code, name_zh]) => ({ code, name_zh })),
};
export function recordRegs(rec) {
  const r = rec.regulations || {};
  if (r.outcomes || rec.conditions?.claim !== "glycemic") return { target: "human", ...r };
  return { ...r, ...LEGACY_GLYCEMIC };
}
