// 載入 data/*.json（由 pipeline build 產生），並合併本瀏覽器「即時文獻檢索」的結果

import { liveData } from "./live.js";
import { buildCombos } from "./rules.js";
import { healthFoodHint } from "./util.js";

let shared = null;

async function getJson(name, optional = false) {
  const r = await fetch(`data/${name}`, { cache: "no-cache" });
  if (!r.ok) { if (optional) return null; throw new Error(`${name} HTTP ${r.status}`); }
  return r.json();
}

export async function loadShared() {
  if (shared) return shared;
  const [meta, combos, findings, regs, prompts] = await Promise.all([
    getJson("meta.json"), getJson("combinations.json"), getJson("findings.json"), getJson("regulations.json"),
    getJson("prompts.json", true)]);
  shared = { meta, combos, findings, regs, prompts: prompts || {} };
  return shared;
}

// 每次切換分頁都重新合併，讓剛檢索完的文獻立即出現在查詢結果
export async function loadData() {
  const s = await loadShared();
  const live = liveData();
  const sharedIds = new Set(s.findings.map((f) => f.finding_id));
  const liveFindings = live.findings.filter((f) => !sharedIds.has(f.finding_id));
  const findings = [...s.findings, ...liveFindings];
  const combos = liveFindings.length ? buildCombos(findings, s.regs, new Date().getFullYear()) : s.combos;
  const findingById = Object.fromEntries(findings.map((f) => [f.finding_id, f]));
  const comboById = Object.fromEntries(combos.map((c) => [c.combo_id, c]));
  const articles = { ...live.articles, ...(s.meta.articles || {}) };
  return { meta: s.meta, regs: s.regs, prompts: s.prompts, combos, findings, findingById, comboById, articles,
           liveCount: Object.keys(live.articles).length };
}

export const claimInfo = (d, code) => d.regs.health_claims.find((c) => c.code === code);
export const claimHint = (d, code, top) => healthFoodHintFor(claimInfo(d, code), top);
const healthFoodHintFor = (claim, top) => healthFoodHint(top, claim?.human_trial_required, claim?.target);
export const lawsFor = (d, target) => (d.regs.laws || []).filter((l) => !l.applies_to || l.applies_to.includes(target || "human"));
// 下拉選單：依應用對象分組
export const claimOptions = (claims, selected) => ["human", "animal"].map((t) => {
  const cs = claims.filter((c) => (c.target || "human") === t);
  return cs.length ? `<optgroup label="${t === "animal" ? "動物飼料" : "人類食品"}">${cs.map((c) =>
    `<option value="${c.code}"${c.code === selected ? " selected" : ""}>${c.name_zh}</option>`).join("")}</optgroup>` : "";
}).join("");
export const announcementsFor = (d, code) =>
  d.regs.announcements.filter((a) => (a.affects || []).includes(code)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
export const ingredientEntry = (d, name, type, target = "human") =>
  d.regs.ingredients.find((i) => i.type === type && i.name.toLowerCase() === String(name || "").toLowerCase()
                                 && (i.scope == null || i.scope === target));
