// 我的紀錄（PES S07、S08；FR-M4-01、02）：列表、並列比較、匯出匯入

import { deleteRecord, listRecords, saveRecords, storageAvailable } from "./store.js";
import { INGREDIENT, PARTS, anatomy, compactDate, download, h, levelChip, toast } from "./util.js";

export function renderRecords(root) {
  const rs = listRecords();
  const warn = storageAvailable() ? "" : `<div class="notice warn">瀏覽器不允許儲存，關閉分頁後紀錄會消失。</div>`;
  root.innerHTML = `${warn}
  <div class="results-head"><h2>我的紀錄</h2>
    <div class="actions" style="margin:0">
      <button class="btn secondary" id="btn-compare" disabled>並列比較</button>
      <button class="btn quiet" id="btn-export" ${rs.length ? "" : "disabled"}>匯出紀錄</button>
      <label class="btn quiet" for="file-import">匯入紀錄</label><input type="file" id="file-import" accept="application/json,.json" hidden>
    </div></div>
  <p class="small muted">紀錄存在這台電腦的瀏覽器中。換電腦前請先匯出，再到新電腦匯入。勾選 2～5 筆可並列比較。</p>
  ${rs.length ? `<div class="table-wrap"><table class="data"><thead><tr><th scope="col"><span class="sr">選取</span></th><th>題目</th><th>組合</th><th>分數</th><th>建立時間</th><th></th></tr></thead><tbody>
    ${rs.map((r) => `<tr>
      <td><input type="checkbox" class="pick" value="${h(r.id)}" aria-label="選取 ${h(r.title)}"></td>
      <td>${h(r.title)}</td>
      <td><span class="latin">${h(r.combo.organism_name)}</span> × ${h(r.combo.substrate)} ${levelChip(r.combo.top_level)}</td>
      <td class="num">${r.combo.score}</td><td class="num small">${h(r.created_at)}</td>
      <td style="white-space:nowrap"><a class="btn quiet" href="#report/${h(r.id)}">產出報告</a>
        <button class="btn danger del" data-id="${h(r.id)}">刪除</button></td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty"><p><strong>還沒有評估紀錄</strong></p><p class="muted">在組合詳情按「存為評估紀錄」即可建立。</p><a class="btn" href="#query">開始查詢</a></div>`}
  <section id="compare"></section>`;

  const picks = () => [...root.querySelectorAll(".pick:checked")].map((x) => x.value);
  root.querySelectorAll(".pick").forEach((cb) => cb.addEventListener("change", () => {
    const n = picks().length; root.querySelector("#btn-compare").disabled = n < 2 || n > 5;
  }));
  root.querySelector("#btn-compare").addEventListener("click", () => renderCompare(root.querySelector("#compare"), picks()));
  root.querySelectorAll(".del").forEach((b) => b.addEventListener("click", () => {
    if (confirm("確定刪除這筆紀錄？刪除後無法復原。")) { deleteRecord(b.dataset.id); renderRecords(root); }
  }));
  root.querySelector("#btn-export").addEventListener("click", () => {
    download(new Blob([JSON.stringify({ format: "fdb-records", version: 1, records: listRecords() }, null, 2)], { type: "application/json" }),
      `${compactDate()}_發酵資料庫_評估紀錄.json`);
  });
  root.querySelector("#file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (doc.format !== "fdb-records" || !Array.isArray(doc.records)) throw new Error("不是本系統匯出的紀錄檔");
      const cur = listRecords(); const ids = new Set(cur.map((r) => r.id));
      const added = doc.records.filter((r) => r.id && r.combo && !ids.has(r.id));
      saveRecords([...added, ...cur]);
      toast(`已匯入 ${added.length} 筆，略過重複 ${doc.records.length - added.length} 筆`);
      renderRecords(root);
    } catch (err) { alert(`匯入失敗：${err.message}`); }
  });
}

function renderCompare(el, ids) {
  const rs = ids.map((id) => listRecords().find((r) => r.id === id)).filter(Boolean);
  const row = (label, fn) => `<tr><th scope="row">${label}</th>${rs.map((r) => `<td>${fn(r)}</td>`).join("")}</tr>`;
  el.innerHTML = `<h3>並列比較</h3><div class="table-wrap"><table class="data"><thead><tr><th></th>${rs.map((r) => `<th>${h(r.title)}</th>`).join("")}</tr></thead><tbody>
    ${row("組合", (r) => `<span class="latin">${h(r.combo.organism_name)}</span> × ${h(r.combo.substrate)}`)}
    ${row("綜合分數", (r) => `<span class="num">${r.combo.score}</span>${anatomy(r.combo.score_parts)}`)}
    ${PARTS.map(([k, l]) => row(l, (r) => `<span class="num">${r.combo.score_parts[k]}</span>`)).join("")}
    ${row("最高證據", (r) => levelChip(r.combo.top_level))}
    ${row("文獻篇數", (r) => `<span class="num">${r.combo.n_articles}</span>`)}
    ${row("原料可用性", (r) => h(INGREDIENT[r.combo.ingredient_status]))}
    ${row("製程", (r) => h(r.combo.process))}
    ${row("評估人意見", (r) => h(r.opinion || "—"))}
    ${row("資料版本", (r) => `<span class="small">${h(r.data_version)}</span>`)}
  </tbody></table></div>`;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
