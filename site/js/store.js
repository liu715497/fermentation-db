// 瀏覽器儲存。所有讀寫包在 try/catch：瀏覽器停用儲存時改為僅本次有效（PIS 錯誤處理）。

const mem = new Map();
let persistent = true;

function backend(kind) {
  try { const s = kind === "session" ? sessionStorage : localStorage; s.setItem("__t", "1"); s.removeItem("__t"); return s; }
  catch { persistent = false; return null; }
}

export const storageAvailable = () => { backend("local"); return persistent; };

export function get(key, kind = "local") {
  const s = backend(kind);
  try { const v = s ? s.getItem(key) : mem.get(key); return v == null ? null : JSON.parse(v); } catch { return null; }
}
export function set(key, value, kind = "local") {
  const s = backend(kind); const v = JSON.stringify(value);
  try { s ? s.setItem(key, v) : mem.set(key, v); } catch { mem.set(key, v); }
}
export function remove(key) {
  for (const kind of ["local", "session"]) { const s = backend(kind); try { s && s.removeItem(key); } catch {} }
  mem.delete(key);
}

const RECORDS = "fdb.records.v1";
export const listRecords = () => get(RECORDS) || [];
export const saveRecords = (rs) => set(RECORDS, rs);
export const getRecord = (id) => listRecords().find((r) => r.id === id);
export function upsertRecord(rec) {
  const rs = listRecords(); const i = rs.findIndex((r) => r.id === rec.id);
  i >= 0 ? (rs[i] = rec) : rs.unshift(rec); saveRecords(rs);
}
export const deleteRecord = (id) => saveRecords(listRecords().filter((r) => r.id !== id));

// 報告編號 FDB-YYYYMMDD-NNN：同一瀏覽器內每日流水號
export function nextReportNo(ymd) {
  const k = "fdb.report-seq"; const seq = get(k) || {};
  seq[ymd] = (seq[ymd] || 0) + 1; set(k, seq);
  return `FDB-${ymd}-${String(seq[ymd]).padStart(3, "0")}`;
}
