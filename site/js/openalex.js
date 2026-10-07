// OpenAlex（免費開放學術資料庫）：被引用數、文章類型、期刊 2 年平均被引用數（仿 IF 計算，非 Clarivate IF）。
// 與 pipeline/openalex.py 同一套查法：以 DOI 批次查文章，再以 ISSN 批次查期刊。

import { get, set } from "./store.js";

const API = "https://api.openalex.org";
const BATCH = 100;   // 單一篩選條件最多 100 個值
const K_KEY = "fdb.openalex";

export const getOpenAlexKey = () => get(K_KEY) || "";
export const saveOpenAlexKey = (k) => set(K_KEY, k);

export const normDoi = (d) => (d ? String(d).trim().toLowerCase().replace(/^https?:\/\/doi\.org\//, "").replace(/^doi:/, "") || null : null);

async function call(path, params, signal) {
  const key = getOpenAlexKey();
  const q = new URLSearchParams({ ...params, ...(key ? { api_key: key } : {}) });
  let r;
  try { r = await fetch(`${API}/${path}?${q}`, { signal }); }
  catch (err) { if (err.name === "AbortError") throw err; throw new Error("無法連到 OpenAlex"); }
  if (r.status === 429) throw new Error("OpenAlex 今日查詢額度已用完，可在設定填入免費的 OpenAlex 金鑰");
  if (!r.ok) throw new Error(`OpenAlex 回傳錯誤 HTTP ${r.status}`);
  return r.json();
}

/** 回傳 Map(doi → { cited_by_count, work_type, journal_name, journal_2yr }) */
export async function lookup(dois, signal) {
  const list = [...new Set(dois.map(normDoi).filter(Boolean))];
  const works = new Map();
  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    const d = await call("works", { filter: `doi:${chunk.map((x) => `https://doi.org/${x}`).join("|")}`,
                                    select: "doi,cited_by_count,type,primary_location", per_page: BATCH }, signal);
    for (const w of d.results || []) {
      const src = w.primary_location?.source || {};
      works.set(normDoi(w.doi), { cited_by_count: w.cited_by_count ?? null, work_type: w.type || null,
                                  journal_name: src.display_name || null, issn_l: src.issn_l || null });
    }
  }
  const issns = [...new Set([...works.values()].map((w) => w.issn_l).filter(Boolean))];
  const metric = new Map();
  for (let i = 0; i < issns.length; i += BATCH) {
    const d = await call("sources", { filter: `issn:${issns.slice(i, i + BATCH).join("|")}`, select: "issn_l,summary_stats", per_page: BATCH }, signal);
    for (const s of d.results || []) {
      const v = s.summary_stats?.["2yr_mean_citedness"];
      if (s.issn_l && v != null) metric.set(s.issn_l, Math.round(v * 100) / 100);
    }
  }
  for (const w of works.values()) w.journal_2yr = w.issn_l ? metric.get(w.issn_l) ?? null : null;
  return works;
}

export async function testOpenAlex() {
  const d = await call("works", { filter: "doi:https://doi.org/10.1371/journal.pone.0266781", select: "cited_by_count" });
  return (d.results || []).length;
}
