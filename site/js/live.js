// 即時文獻檢索（SW Arch v0.3 流程 D）：瀏覽器直接查 PMC，用使用者自選的 AI 擷取，結果只存在本瀏覽器。
// 只使用 PMC 允許自動取得的 E-utilities；請求間隔 0.4 秒（NCBI 不帶金鑰時每秒上限 3 次）。

import { complete } from "./ai.js";
import { get, remove, set } from "./store.js";
import { STUDY_TYPE_LEVEL, enrichFinding } from "./rules.js";
import { lookup, normDoi } from "./openalex.js";
import { nowStr } from "./util.js";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const K_FINDINGS = "fdb.live.findings";
const K_ARTICLES = "fdb.live.articles";
const K_NCBI = "fdb.ncbi";
const MAX_TEXT = 30000;           // 送給 AI 的全文字數上限，控制費用
const XLINK = "http://www.w3.org/1999/xlink";

export const liveData = () => ({ findings: get(K_FINDINGS) || [], articles: get(K_ARTICLES) || {} });
export const clearLive = () => { remove(K_FINDINGS); remove(K_ARTICLES); };
export const getNcbi = () => get(K_NCBI) || { email: "", apiKey: "" };
export const saveNcbi = (v) => set(K_NCBI, v);

let last = 0;
async function ncbi(path, params, signal) {
  const n = getNcbi();
  const wait = (n.apiKey ? 150 : 400) - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const q = new URLSearchParams({ ...params, tool: "fermentation-db" });
  if (n.email) q.set("email", n.email);
  if (n.apiKey) q.set("api_key", n.apiKey);
  let r;
  try { r = await fetch(`${EUTILS}/${path}?${q}`, { signal }); }
  catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("無法連到 PMC（NCBI）。可能是網路不通，或瀏覽器擋下了跨網站請求。");
  }
  if (r.status === 429) throw new Error("PMC 請求太頻繁，請稍候一分鐘再試，或在設定中填入 NCBI API key。");
  if (!r.ok) throw new Error(`PMC 回傳錯誤 HTTP ${r.status}`);
  return r;
}

export async function testPmc() {
  const r = await ncbi("esearch.fcgi", { db: "pmc", term: "fermented AND open access[filter]", retmax: 1, retmode: "json" });
  const d = await r.json();
  return Number(d.esearchresult?.count || 0);
}

// 回傳 { total: 全部符合篇數, ids: 本次取回的 PMC 數字編號 }
export async function searchIds(term, retmax, signal) {
  const r = await ncbi("esearch.fcgi", { db: "pmc", term, retmax, retmode: "json" }, signal);
  const res = (await r.json()).esearchresult || {};
  return { total: Number(res.count || 0), ids: res.idlist || [] };
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

function licenseLabel(lic) {
  if (!lic) return "unknown";
  const ref = [...lic.getElementsByTagName("*")].find((e) => e.localName === "license_ref");
  const href = (lic.getAttributeNS(XLINK, "href") || lic.getAttribute("xlink:href") || (ref ? ref.textContent : "")).toLowerCase();
  if (href.includes("publicdomain/zero")) return "CC0";
  const m = href.match(/creativecommons\.org\/licenses\/([a-z-]+)/);
  if (m) return `CC ${m[1].toUpperCase()}`;
  const t = text(lic).toLowerCase();
  if (t.includes("creative commons attribution") && !/non-?commercial/.test(t)) return "CC BY";
  return "unknown";
}

// 解析 efetch 回傳的 JATS：書目、授權，以及標題、摘要、方法、結果段落
export function parseJats(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return [...doc.getElementsByTagName("article")].map((art) => {
    const meta = art.querySelector("front > article-meta");
    if (!meta) return null;
    const ids = Object.fromEntries([...meta.querySelectorAll(":scope > article-id")].map((e) => [e.getAttribute("pub-id-type"), e.textContent.trim()]));
    const raw = ids.pmcid || ids.pmc || ids.pmcaid;
    if (!raw) return null;
    const pmcid = raw.toUpperCase().startsWith("PMC") ? raw : `PMC${raw}`;
    const yearEl = [...meta.querySelectorAll("pub-date year")].find((y) => /^\d{4}$/.test(y.textContent.trim()));
    const title = text(meta.querySelector("title-group > article-title"));
    const parts = [`[TITLE] ${title}`];
    const abs = meta.querySelector("abstract");
    if (abs) parts.push(`[ABSTRACT] ${text(abs)}`);
    const secs = [...art.querySelectorAll("body > sec")];
    const keep = secs.filter((s) => /method|material|result|experiment|design|subject|participant/i.test(text(s.querySelector(":scope > title"))));
    (keep.length ? keep : secs).forEach((s) => parts.push(`[${text(s.querySelector(":scope > title")) || "BODY"}] ${text(s)}`));
    return {
      pmcid, pmid: ids.pmid || null, doi: ids.doi || null, title,
      first_author: text(meta.querySelector("contrib-group contrib[contrib-type='author'] surname")) || null,
      year: yearEl ? Number(yearEl.textContent.trim()) : null,
      journal: text(art.querySelector("front > journal-meta journal-title")) || null,
      license: licenseLabel(meta.querySelector("permissions > license")),
      url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`,
      fulltext: parts.join("\n").slice(0, MAX_TEXT),
    };
  }).filter(Boolean);
}

const DIRS = ["positive", "null", "negative"];
const FORMS = ["beverage", "powder", "tablet", "capsule", "other"];

// 與 pipeline/schema.py 相同的必要欄位檢查；不合格時拋出錯誤供重試
// allowed：此保健功效的指標代碼（health_claims.yaml outcomes）
export function checkAi(textOut, allowed) {
  let data = JSON.parse(textOut.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  // 與 pipeline/extract.py normalize_ai 相同：模型省略外層時包回 {"findings": [...]}
  if (Array.isArray(data)) data = { findings: data };
  else if (data && !("findings" in data) && "is_fermented" in data) data = { findings: [data] };
  if (!Array.isArray(data?.findings)) throw new Error("缺少 findings 陣列");
  data.findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    if (typeof f.is_fermented !== "boolean") throw new Error(`${at}.is_fermented 必須是 true 或 false`);
    if (!f.is_fermented) return;
    if (!f.organism || typeof f.organism !== "object") throw new Error(`${at}.organism 缺少`);
    if (!f.substrate) throw new Error(`${at}.substrate 缺少`);
    if (!(f.study_type in STUDY_TYPE_LEVEL)) throw new Error(`${at}.study_type 不是允許的代碼`);
    if (!DIRS.includes(f.result_direction)) throw new Error(`${at}.result_direction 不是允許的代碼`);
    if (!Array.isArray(f.outcomes) || f.outcomes.some((o) => !allowed.includes(o))) throw new Error(`${at}.outcomes 只能使用：${allowed.join("、")}`);
    if (typeof f.summary_zh !== "string" || !f.summary_zh.trim()) throw new Error(`${at}.summary_zh 缺少`);
    if (f.product_form != null && !FORMS.includes(f.product_form)) f.product_form = "other";
    f.summary_zh = f.summary_zh.trim().slice(0, 60);
  });
  return data.findings;
}

async function extractOne(prompt, article, allowed) {
  let out = await complete(prompt, article.fulltext, 4000);
  try { return checkAi(out, allowed); }
  catch (first) {
    out = await complete(prompt, `${article.fulltext}\n\n（上一次輸出不符合格式：${first.message}。請只輸出修正後的 JSON。）`, 4000);
    return checkAi(out, allowed);
  }
}

// 人體試驗用語：「人體試驗優先」排序時，先處理符合這組用語的文獻
const HUMAN_TERMS = '(randomized[tiab] OR randomised[tiab] OR "clinical trial"[tiab] OR "double-blind"[tiab] OR participants[tiab] OR volunteers[tiab])';
const quote = (k) => (/\s/.test(k) ? `"${k}"` : k);
// 關鍵字以逗號分隔；含空白者視為片語（例如 black rice）
const words = (s) => (s || "").split(/[,，;；]+/).map((x) => x.trim()).filter(Boolean);

/** 依檢索參數組成 PMC 查詢式；p.advanced 有值時直接使用，讓使用者完全自訂 */
export function buildTerm(claim, p) {
  if (p.advanced && p.advanced.trim()) return p.advanced.trim();
  const parts = [`(${claim.search_query.replace(/\s+/g, " ")})`];
  const all = words(p.mustAll); const any = words(p.anyOf); const not = words(p.exclude);
  if (all.length) parts.push(`(${all.map((k) => `${quote(k)}[tiab]`).join(" AND ")})`);
  if (any.length) parts.push(`(${any.map((k) => `${quote(k)}[tiab]`).join(" OR ")})`);
  let term = parts.join(" AND ");
  if (p.yearFrom || p.yearTo) term += ` AND (${p.yearFrom || 1900}:${p.yearTo || 3000}[pdat])`;
  if (not.length) term += ` NOT (${not.map((k) => `${quote(k)}[tiab]`).join(" OR ")})`;
  return term;
}

// esummary：在送 AI 前先取得 DOI 與年份，供 OpenAlex 查詢與篩選（每次最多 200 篇）
async function summaries(ids, signal) {
  const out = {};
  for (let i = 0; i < ids.length; i += 200) {
    const r = await ncbi("esummary.fcgi", { db: "pmc", id: ids.slice(i, i + 200).join(","), retmode: "json" }, signal);
    const res = (await r.json()).result || {};
    for (const uid of res.uids || []) {
      const d = res[uid] || {};
      const aid = Object.fromEntries((d.articleids || []).map((x) => [x.idtype, x.value]));
      const y = String(d.pubdate || d.epubdate || "").match(/\d{4}/);
      out[uid] = { doi: aid.doi || null, year: y ? Number(y[0]) : null, title: d.title || "" };
    }
  }
  return out;
}

const SORTERS = {
  newest: (a, b) => b.n - a.n,
  human: (a, b) => (b.human - a.human) || (b.n - a.n),
  cited: (a, b) => ((b.cited ?? -1) - (a.cited ?? -1)) || (b.n - a.n),
  journal: (a, b) => ((b.journal ?? -1) - (a.journal ?? -1)) || (b.n - a.n),
};

/**
 * 篩選與排序候選文獻（送 AI 之前，不花 AI 費用）。
 * 回傳 { total, eligible: [{pmcid, n, doi, year, cited, journal, type, human}], notes: [] }
 */
export async function screen(claim, p, knownIds, onLog, signal) {
  const term = buildTerm(claim, p);
  const { total, ids } = await searchIds(term, 500, signal);
  const notes = [];
  if (total > ids.length) notes.push(`符合 ${total} 篇，只從其中 ${ids.length} 篇中挑選`);
  let human = new Set();
  if (p.sort === "human") human = new Set((await searchIds(`(${term}) AND ${HUMAN_TERMS}`, 500, signal)).ids);
  let rows = ids.filter((id) => !knownIds.has(`PMC${id}`)).map((id) => ({ pmcid: `PMC${id}`, n: Number(id), human: human.has(id) ? 1 : 0 }));
  const done = ids.length - rows.length;

  const needMetrics = p.useOpenAlex || p.sort === "cited" || p.sort === "journal" || p.minCited || p.minJournal || p.type !== "any";
  if (rows.length && needMetrics) {
    onLog(`查詢 ${rows.length} 篇的被引用數與期刊指標（OpenAlex）…`);
    try {
      const meta = await summaries(rows.map((r) => String(r.n)), signal);
      const m = await lookup(Object.values(meta).map((x) => x.doi), signal);
      rows.forEach((r) => {
        const s = meta[String(r.n)] || {}; const w = m.get(normDoi(s.doi)) || {};
        Object.assign(r, { doi: s.doi, year: s.year, title: s.title, cited: w.cited_by_count ?? null, journal: w.journal_2yr ?? null,
                           type: w.work_type || null, journalName: w.journal_name || null });
      });
      const miss = rows.filter((r) => r.cited == null).length;
      if (miss) notes.push(`${miss} 篇在 OpenAlex 查無資料，被引用數與期刊指標不計分，也不受這兩項篩選排除`);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      notes.push(`被引用數與期刊指標取得失敗（${err.message.slice(0, 60)}），本次不使用這兩項`);
    }
  }
  const before = rows.length;
  if (p.type === "no_review") rows = rows.filter((r) => r.type !== "review");
  if (p.type === "review") rows = rows.filter((r) => r.type === "review");
  if (p.minCited) rows = rows.filter((r) => r.cited == null || r.cited >= p.minCited);
  if (p.minJournal) rows = rows.filter((r) => r.journal == null || r.journal >= p.minJournal);
  if (before > rows.length) notes.push(`依文章類型、被引用數、期刊指標排除 ${before - rows.length} 篇`);
  rows.sort(SORTERS[p.sort] || SORTERS.newest);
  return { term, total, done, eligible: rows, notes };
}

/**
 * 執行一次即時檢索。
 * opts: { claim, prompt, regs, params, count, knownIds:Set, model, provider, onLog(msg), signal }
 * 回傳統計；結果寫入本瀏覽器。
 */
export async function runLive(opts) {
  const { claim, prompt, regs, params, count, knownIds, onLog, signal } = opts;
  onLog("查詢 PMC 開放取用文獻…");
  const sc = await screen(claim, params, knownIds, onLog, signal);
  sc.notes.forEach((n) => onLog(`  註：${n}`));
  const picked = sc.eligible.slice(0, count);
  const byPmc = Object.fromEntries(picked.map((r) => [r.pmcid, r]));
  const fresh = picked.map((r) => r.pmcid);
  const remaining = sc.eligible.length - fresh.length;
  onLog(`PMC 共 ${sc.total} 篇符合；已處理過 ${sc.done} 篇；篩選後尚有 ${sc.eligible.length} 篇，本次處理 ${fresh.length} 篇。`);
  const stats = { found: sc.total, done: 0, findings: 0, notFermented: 0, unknownLicense: 0, failed: 0, remaining };
  if (!fresh.length) return stats;

  const store = liveData();
  let pos = 0;
  for (let i = 0; i < fresh.length; i += 5) {
    const batch = fresh.slice(i, i + 5);
    const r = await ncbi("efetch.fcgi", { db: "pmc", id: batch.map((p) => p.slice(3)).join(","), retmode: "xml" }, signal);
    const arts = parseJats(await r.text());
    for (const a of arts) {
      if (signal?.aborted) throw new DOMException("已取消", "AbortError");
      pos++;
      const { fulltext, ...article } = a;
      article.fetched_at = nowStr();
      article.source = "live";
      const mx = byPmc[a.pmcid] || {};
      if (mx.cited !== undefined) Object.assign(article, { cited_by_count: mx.cited, journal_2yr: mx.journal, work_type: mx.type,
                                                         metrics_source: mx.cited == null ? null : "OpenAlex" });
      store.articles[a.pmcid] = article;
      if (a.license === "unknown") {
        stats.unknownLicense++; onLog(`略過 ${a.pmcid}：授權不明，只保留書目。`);
        set(K_ARTICLES, store.articles);   // 記為已檢索，下次不再重複查詢
        continue;
      }
      onLog(`AI 整理 ${a.pmcid}（第 ${pos}/${fresh.length} 篇）…`);
      try {
        const fs = await extractOne(prompt, a, (claim.outcomes || []).map((o) => o.code));
        const stamp = nowStr();
        fs.forEach((f, k) => {
          f.finding_id = `${a.pmcid}-${k + 1}`;
          f.health_claim = claim.code;
          f.extraction = { provider: opts.provider, model: opts.model, extracted_at: stamp, extractor: "網站即時檢索",
                           status: "auto", source: "live", reviewer: null, reviewed_at: null };
          if (f.is_fermented) { store.findings.push(enrichFinding(f, article, regs)); stats.findings++; }
          else stats.notFermented++;
        });
        if (!fs.some((f) => f.is_fermented)) {
          const why = fs.map((f) => f.exclude_reason).find(Boolean);
          onLog(`  不符合範圍${why ? `：${String(why).slice(0, 40)}` : ""}`);
        }
        stats.done++;
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (/金鑰|額度|無法連線|設定/.test(err.message)) { set(K_FINDINGS, store.findings); set(K_ARTICLES, store.articles); throw err; }
        stats.failed++; onLog(`  ${a.pmcid} 整理失敗：${err.message}`);
        delete store.articles[a.pmcid];   // 失敗的文獻不記為已檢索，下次會再試
      }
      set(K_FINDINGS, store.findings); set(K_ARTICLES, store.articles);   // 每篇存一次，中途取消也保留已完成的
    }
  }
  return stats;
}
