// 證據等級、菌名正規化與綜合分數：與 pipeline/evidence.py、taxonomy.py、scoring.py 同一套規則。
// 修改計分規則時，兩邊須一起改（單元測試 TC-D03、D04 的預期值可用來核對）。

export const STUDY_TYPE_LEVEL = {
  meta_analysis: "A", systematic_review: "A", rct: "A", non_rct_human: "B", observational: "B",
  animal: "C", in_vitro: "D", review: "E", opinion: "E",
};
const SCORED = ["A", "B", "C", "D"];
const STATUS_RANK = { available: 0, confirm: 1, unavailable: 2 };
export const DEFAULT_SCORING = {
  level_points: { A: 40, B: 30, C: 15, D: 5 }, count: { weight: 20, cap: 5 }, consistency: { weight: 20 },
  ingredient_points: { available: 10, confirm: 5, unavailable: 0 }, recency: { weight: 10, years: 5 },
};

const bestLevel = (levels) => levels.filter((l) => SCORED.includes(l)).sort()[0] || null;

export function canonicalName(genus, species, aliases) {
  const name = [genus, species].filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join(" ");
  if (!name) return "unknown";
  const norm = name[0].toUpperCase() + name.slice(1).toLowerCase();
  const hit = (aliases || []).find((a) => a.old.toLowerCase() === norm.toLowerCase());
  return hit ? hit.current : norm;
}
const slug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
export const comboId = (claim, organism, substrate) => `${claim}::${slug(organism)}__${slug(substrate || "unknown")}`;

function scoreCombination(findings, ingredient, dataYear, cfg) {
  const arts = {};
  for (const f of findings) {
    if (!SCORED.includes(f.level)) continue;
    const a = (arts[f.pmcid] ??= { levels: [], dirs: [], year: f.year });
    a.levels.push(f.level); a.dirs.push(f.result_direction);
  }
  const list = Object.values(arts);
  const n = list.length;
  if (!n) return null;
  list.forEach((a) => {
    a.level = bestLevel(a.levels);
    a.dir = a.dirs.includes("positive") ? "positive" : a.dirs.includes("negative") ? "negative" : "null";
  });
  const top = bestLevel(list.map((a) => a.level));
  const positive = list.filter((a) => a.dir === "positive").length;
  const recent = list.filter((a) => a.year && a.year > dataYear - cfg.recency.years).length;
  const parts = {
    evidence: cfg.level_points[top],
    count: (cfg.count.weight * Math.min(n, cfg.count.cap)) / cfg.count.cap,
    consistency: (cfg.consistency.weight * positive) / n,
    ingredient: cfg.ingredient_points[ingredient],
    recency: (cfg.recency.weight * recent) / n,
  };
  const sum = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    score: Math.floor(sum + 0.5),
    score_parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    top_level: top, n_articles: n,
    counts_by_level: Object.fromEntries(SCORED.map((l) => [l, list.filter((a) => a.level === l).length])),
    positive_ratio: Math.round((positive / n) * 1000) / 1000,
    latest_year: Math.max(...list.map((a) => a.year || 0)),
  };
}

function ingredientStatus(regs, name, type) {
  const e = (regs.ingredients || []).find((i) => i.type === type && i.name.toLowerCase() === String(name || "").toLowerCase());
  return e ? e.status : "confirm";
}

// 把擷取結果補上計分需要的欄位（與 build.py 相同）
export function enrichFinding(f, article, regs) {
  const org = f.organism || {};
  const name = canonicalName(org.genus, org.species, regs.taxonomy_aliases);
  return { ...f, pmcid: article.pmcid, organism_name: name, level: STUDY_TYPE_LEVEL[f.study_type],
           year: article.year, license: article.license, combo_id: comboId(f.health_claim, name, f.substrate) };
}

export function buildCombos(findings, regs, dataYear) {
  const cfg = regs.scoring || DEFAULT_SCORING;
  const enabled = new Set((regs.health_claims || []).filter((c) => c.enabled).map((c) => c.code));
  const groups = {};
  for (const f of findings) {
    if (!f.is_fermented || !enabled.has(f.health_claim)) continue;
    (groups[f.combo_id] ??= []).push(f);
  }
  const rank = (s) => STATUS_RANK[s];
  const combos = [];
  for (const [id, fs] of Object.entries(groups)) {
    const first = fs[0];
    const a = ingredientStatus(regs, first.organism_name, "organism");
    const b = ingredientStatus(regs, first.substrate, "substrate");
    const scored = scoreCombination(fs, rank(a) >= rank(b) ? a : b, dataYear, cfg);
    if (!scored) continue;
    combos.push({ combo_id: id, health_claim: first.health_claim, organism_name: first.organism_name,
                  substrate: first.substrate, findings: fs.map((f) => f.finding_id),
                  ingredient_status: rank(a) >= rank(b) ? a : b, ...scored });
  }
  return combos.sort((x, y) => y.score - x.score || y.n_articles - x.n_articles || y.latest_year - x.latest_year);
}
