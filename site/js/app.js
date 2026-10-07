// 進入點：載入資料、依網址 # 切換分頁

import { loadData } from "./data.js";
import { renderCombo } from "./detail.js";
import { isRunning, renderLive, stopLive } from "./livepage.js";
import { renderRecords } from "./records.js";
import { renderReport } from "./report.js";
import { renderQuery } from "./search.js";
import { renderSettings } from "./settings.js";
import { h } from "./util.js";

const main = document.querySelector("main");
const TABS = { query: "查詢", live: "文獻檢索", records: "我的紀錄", report: "報告", settings: "設定" };

function setTab(tab) {
  document.querySelectorAll("nav.tabs a").forEach((a) => {
    a.toggleAttribute("aria-current", a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
  });
}

async function route() {
  if (isRunning()) {
    if (!confirm("文獻檢索進行中，離開此頁會停止檢索（已完成的會保留）。確定離開？")) { history.replaceState(null, "", "#live"); return; }
    stopLive();
  }
  let data;
  try { data = await loadData(); }
  catch (err) {
    main.innerHTML = `<div class="empty"><p><strong>資料載入失敗，請重新整理</strong></p><p class="small muted">${h(err.message)}</p>
      <button class="btn" onclick="location.reload()">重新整理</button></div>`;
    return;
  }
  document.getElementById("ver").textContent = `資料版本 ${data.meta.data_version}`;
  const [tab, arg] = (location.hash.slice(1) || "query").split("/").map(decodeURIComponent);
  const view = { query: "query", combo: "query", live: "live", records: "records", report: "report", settings: "settings" }[tab] || "query";
  setTab(view);
  document.title = `${TABS[view]}｜發酵資料庫（測試版）`;
  if (tab === "combo") renderCombo(main, data, arg);
  else if (view === "live") renderLive(main, data);
  else if (view === "records") renderRecords(main);
  else if (view === "report") renderReport(main, data, arg);
  else if (view === "settings") renderSettings(main, data);
  else renderQuery(main, data);
  if (tab !== "query") window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

window.addEventListener("hashchange", route);
route();
