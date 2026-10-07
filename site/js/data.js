// 載入 data/*.json（由 pipeline build 產生），建立索引

let cache = null;

async function getJson(name) {
  const r = await fetch(`data/${name}`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
  return r.json();
}

export async function loadData() {
  if (cache) return cache;
  const [meta, combos, findings, regs] = await Promise.all(
    ["meta.json", "combinations.json", "findings.json", "regulations.json"].map(getJson));
  const findingById = Object.fromEntries(findings.map((f) => [f.finding_id, f]));
  const comboById = Object.fromEntries(combos.map((c) => [c.combo_id, c]));
  cache = { meta, combos, findings, findingById, comboById, regs, articles: meta.articles || {} };
  return cache;
}

export const claimInfo = (d, code) => d.regs.health_claims.find((c) => c.code === code);
export const announcementsFor = (d, code) =>
  d.regs.announcements.filter((a) => (a.affects || []).includes(code)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
export const ingredientEntry = (d, name, type) =>
  d.regs.ingredients.find((i) => i.type === type && i.name.toLowerCase() === String(name || "").toLowerCase());
