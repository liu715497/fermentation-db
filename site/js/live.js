// 即時文獻檢索（SW Arch v0.3 流程 D）：瀏覽器直接查 PMC，用使用者自選的 AI 擷取，結果只存在本瀏覽器。
// 只使用 PMC 允許自動取得的 E-utilities；請求間隔 0.4 秒（NCBI 不帶金鑰時每秒上限 3 次）。

import { complete } from "./ai.js";
import { get, remove, set } from "./store.js";
import { STUDY_TYPE_LEVEL, enrichFinding } from "./rules.js";
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
const OUTS = ["fpg", "hba1c", "ogtt_auc", "homa_ir", "ppg", "insulin", "other"];
const FORMS = ["beverage", "powder", "tablet", "capsule", "other"];

// 與 pipeline/schema.py 相同的必要欄位檢查；不合格時拋出錯誤供重試
export function checkAi(textOut) {
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
    if (!Array.isArray(f.outcomes) || f.outcomes.some((o) => !OUTS.includes(o))) throw new Error(`${at}.outcomes 含不允許的代碼`);
    if (typeof f.summary_zh !== "string" || !f.summary_zh.trim()) throw new Error(`${at}.summary_zh 缺少`);
    if (f.product_form != null && !FORMS.includes(f.product_form)) f.product_form = "other";
    f.summary_zh = f.summary_zh.trim().slice(0, 60);
  });
  return data.findings;
}

async function extractOne(prompt, article) {
  let out = await complete(prompt, article.fulltext, 4000);
  try { return checkAi(out); }
  catch (first) {
    out = await complete(prompt, `${article.fulltext}\n\n（上一次輸出不符合格式：${first.message}。請只輸出修正後的 JSON。）`, 4000);
    return checkAi(out);
  }
}

/**
 * 執行一次即時檢索。
 * opts: { claim, prompt, regs, keyword, count, knownIds:Set, model, provider, onLog(msg), signal }
 * 回傳統計；結果寫入本瀏覽器。
 */
export async function runLive(opts) {
  const { claim, prompt, regs, keyword, count, knownIds, onLog, signal } = opts;
  const kw = keyword.trim() ? ` AND (${keyword.trim().split(/[,，\s]+/).filter(Boolean).map((k) => `${k}[tiab]`).join(" AND ")})` : "";
  const term = `(${claim.search_query.replace(/\s+/g, " ")})${kw}`;
  onLog("查詢 PMC 開放取用文獻…");
  // 固定取回 500 筆再依 PMC 編號由大到小挑選（編號越大越晚收錄），較接近「最新」
  const { total, ids } = await searchIds(term, 500, signal);
  const fresh = ids.map(Number).sort((a, b) => b - a).map((n) => `PMC${n}`).filter((p) => !knownIds.has(p)).slice(0, count);
  onLog(`PMC 共 ${total} 篇符合條件，本次處理最新的 ${fresh.length} 篇（略過已檢索過的）。`);
  const stats = { found: total, done: 0, findings: 0, notFermented: 0, unknownLicense: 0, failed: 0 };
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
      store.articles[a.pmcid] = article;
      if (a.license === "unknown") {
        stats.unknownLicense++; onLog(`略過 ${a.pmcid}：授權不明，只保留書目。`);
        set(K_ARTICLES, store.articles);   // 記為已檢索，下次不再重複查詢
        continue;
      }
      onLog(`AI 整理 ${a.pmcid}（第 ${pos}/${fresh.length} 篇）…`);
      try {
        const fs = await extractOne(prompt, a);
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
