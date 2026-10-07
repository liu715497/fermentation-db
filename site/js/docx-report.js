// 正式報告 Word 草稿（依「正式報告格式範本 v0.1」）。docx 套件放在 site/vendor，需要時才載入。
// 測試版決定：不顯示本所名稱與標誌；頁首標示「測試版」與「草稿」，無核定流程。

import { nextReportNo } from "./store.js";
import { DIRECTION, DISCLAIMER, FORM, INGREDIENT, STUDY_TYPE, compactDate, download, healthFoodHint, nowStr, outcomeText, recordRegs } from "./util.js";

const VENDOR = "vendor/docx-9.9.0.iife.js";
const CONTENT_W = 9638;            // A4 寬 11906 − 左右邊界各 1134（2.0 cm），單位 DXA
const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "DFKai-SB" };   // DFKai-SB＝標楷體

function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src: VENDOR });
    s.onload = () => resolve(window.docx);
    s.onerror = () => reject(new Error("Word 產生元件載入失敗，請重新整理後再試"));
    document.head.appendChild(s);
  });
}

const blank = (v) => (v && String(v).trim() ? String(v).trim() : "【未填寫】");

export async function buildFormalReport(rec, inp) {
  const d = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
          HeadingLevel, Header, Footer, PageNumber, ShadingType, PageBreak, TabStopType } = d;

  const P = (text, opt = {}) => new Paragraph({ ...opt, children: [new TextRun({ text: String(text ?? ""), ...(opt.run || {}) })] });
  const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
  const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
  const caption = (t) => P(t, { run: { bold: true, size: 20 }, spacing: { before: 120, after: 60 } });
  const multi = (v) => blank(v).split(/\n/).map((line) => P(line));

  function table(headers, rows, widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    const w = widths.map((x) => Math.round((x / total) * CONTENT_W));
    w[w.length - 1] += CONTENT_W - w.reduce((a, b) => a + b, 0);
    const cell = (text, i, head) => new TableCell({
      width: { size: w[i], type: WidthType.DXA },
      shading: head ? { type: ShadingType.CLEAR, fill: "E7E7E7", color: "auto" } : undefined,
      children: String(text ?? "").split("\n").map((t) => new Paragraph({ spacing: { line: 260 }, children: [new TextRun({ text: t, size: 20, bold: !!head })] })),
    });
    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w,
      rows: [
        new TableRow({ tableHeader: true, children: headers.map((t, i) => cell(t, i, true)) }),
        ...rows.map((r) => new TableRow({ children: r.map((t, i) => cell(t, i, false)) })),
      ],
    });
  }

  const reportNo = nextReportNo(compactDate());
  const c = rec.combo; const cond = rec.conditions; const em = rec.regulations.evaluation_method || {};
  const arts = rec.articles;
  const byArticle = {};
  rec.findings.forEach((f) => (byArticle[f.pmcid] ??= []).push(f));
  const pmcids = Object.keys(byArticle).sort((a, b) => byArticle[a][0].level.localeCompare(byArticle[b][0].level) || (arts[b]?.year || 0) - (arts[a]?.year || 0));
  const lid = Object.fromEntries(pmcids.map((p, i) => [p, `L${i + 1}`]));
  const reviewTag = (f) => (f.extraction?.status === "reviewed" ? `已複核（${f.extraction.reviewer}）` : "自動擷取，未複核");
  const unreviewed = rec.findings.filter((f) => f.extraction?.status !== "reviewed").length;
  const hfPath = (lv) => healthFoodHint(lv, recordRegs(rec).human_trial_required);
  const formName = cond.form === "any" ? "不限" : FORM[cond.form] || cond.form;
  const gaps = blank(inp.gaps) === "【未填寫】" ? [["【未填寫】", "", "", ""]]
    : inp.gaps.split(/\n/).filter((l) => l.trim()).map((l) => { const p = l.split(/[;；]/).map((x) => x.trim()); while (p.length < 4) p.push(""); return p.slice(0, 4); });
  // 與綜合分數相同規則：一篇有任一試驗組支持即算支持，否則有相反算相反，其餘算無差異
  const artDir = (p) => { const ds = byArticle[p].map((f) => f.result_direction); return ds.includes("positive") ? "positive" : ds.includes("negative") ? "negative" : "null"; };
  const dirCount = (k) => pmcids.filter((p) => artDir(p) === k).map((p) => lid[p]);

  const cover = [
    P("", { spacing: { before: 2400 } }),
    P("發酵研發題目評估報告", { alignment: AlignmentType.CENTER, run: { size: 40, bold: true } }),
    P("測試版　草稿", { alignment: AlignmentType.CENTER, run: { size: 24, color: "A85A12" }, spacing: { after: 240 } }),
    P(rec.title, { alignment: AlignmentType.CENTER, run: { size: 28 }, spacing: { after: 600 } }),
    table(["欄位", "內容"], [
      ["報告編號", reportNo], ["版次", "v0.1"], ["保健功效", cond.claim_name], ["產品型態", formName],
      ["評估人", blank(inp.evaluator)], ["審核人", blank(inp.reviewer)], ["評估日期", rec.created_at.slice(0, 10)],
      ["核定日期", "待審（測試版無核定流程）"], ["資料版本", rec.data_version], ["報告狀態", "草稿"],
    ], [1, 3]),
    P("資料分級：內部", { alignment: AlignmentType.CENTER, spacing: { before: 480 }, run: { size: 20, color: "555555" } }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const body = [
    H1("第 1 章 摘要"), H2("1.1 評估結論"), ...multi(inp.conclusion),
    H2("1.2 前三名組合"), caption("表 1-1 前三名候選組合"),
    table(["名次", "菌種", "原料", "製程摘要", "最高等級", "篇數", "分數", "法規路徑"],
      rec.top10.slice(0, 3).map((t) => [t.rank, t.organism_name, t.substrate, t.process, t.top_level, t.n_articles, t.score, hfPath(t.top_level)]),
      [5, 16, 11, 11, 7, 6, 6, 14]),
    H2("1.3 主要風險"), P(`證據缺口：${blank(inp.risk_evidence)}`), P(`法規限制：${blank(inp.risk_regulatory)}`),

    H1("第 2 章 評估條件與查詢參數"), caption("表 2-1 查詢條件"),
    table(["項目", "內容"], [
      ["保健功效", cond.claim_name], ["產品型態", formName], ["原料偏好", cond.prefer || "無"], ["排除條件", cond.exclude || "無"],
      ["證據等級篩選", (cond.levels || []).join("、")], ["查詢時間", `${rec.created_at}（UTC+8）`],
      ["資料快照", rec.data_version], ["符合條件組合數", `${cond.n_matched} 組`],
    ], [1, 3]),

    H1("第 3 章 候選組合比較"), caption("表 3-1 前 10 名候選組合與因子分數"),
    table(["名次", "菌種 × 原料", "等級", "證據", "篇數", "一致性", "原料", "新近度", "引用", "期刊", "總分"],
      rec.top10.map((t) => [t.rank, `${t.organism_name} × ${t.substrate}`, t.top_level, t.score_parts.evidence, t.score_parts.count,
        t.score_parts.consistency, t.score_parts.ingredient, t.score_parts.recency, t.score_parts.citation ?? "—", t.score_parts.journal ?? "—", t.score]),
      [5, 22, 5, 6, 6, 7, 6, 7, 6, 6, 6]),
    P("註：綜合分數依產出當時的 scoring.yaml 權重計算；被引用數與期刊指標取自 OpenAlex，期刊指標為仿 IF 計算的 2 年平均被引用數，非 Clarivate IF。分數為篩選參考，不代表功效。", { run: { size: 20 } }),
    P(`選定組合：${c.organism_name} × ${c.substrate}（${c.score} 分）`),
    P("選定理由："), ...multi(inp.selection_reason),

    H1("第 4 章 選定組合證據分析"), H2("4.1 支持文獻"), caption("表 4-1 選定組合支持文獻（依證據等級、年份排序）"),
    table(["編號", "文獻", "PMCID", "等級", "對象與人數", "劑量與期間", "主要結果", "複核狀態"],
      pmcids.flatMap((p) => byArticle[p].map((f) => [lid[p], `${arts[p]?.first_author || ""}, ${arts[p]?.year || ""}`, p, `${f.level} ${STUDY_TYPE[f.study_type] || ""}`,
        `${f.subjects?.population || "未載明"}${f.subjects?.n != null ? `，${f.subjects.n}` : ""}`,
        `${f.dose?.amount != null ? `${f.dose.amount} ${f.dose.unit || ""} ${f.dose.frequency || ""}` : "未載明"}${f.duration_days != null ? `，${f.duration_days} 天` : ""}`,
        `${DIRECTION[f.result_direction]}：${f.summary_zh}（${outcomeText(f.outcomes, recordRegs(rec).outcomes)}）`, reviewTag(f)])),
      [6, 12, 11, 11, 13, 13, 24, 10]),
    H2("4.2 證據等級分布"), caption("表 4-2 證據等級篇數"),
    table(["等級", "A", "B", "C", "D", "合計"], [["篇數", ...["A", "B", "C", "D"].map((lv) => c.counts_by_level[lv] || 0), c.n_articles]], [2, 1, 1, 1, 1, 1]),
    P("等級 E（綜述、意見文章）不計入。", { run: { size: 20 } }),
    H2("4.3 結果一致性"), caption("表 4-3 結果方向"),
    table(["結果方向", "篇數", "文獻編號"], ["positive", "null", "negative"].map((k) => { const ids = dirCount(k); return [DIRECTION[k], ids.length, ids.join("、") || "—"]; }), [2, 1, 3]),
    P("不一致原因判斷："), ...multi(inp.inconsistency_note),

    H1("第 5 章 法規路徑分析"),
    H2("5.1 以一般食品上市"),
    P(`宣稱限制：不得宣稱保健或醫療功效。相關法規：${(rec.regulations.laws || []).map((l) => `${l.name_zh}${l.relevant_articles && l.relevant_articles !== "待填" ? `（${l.relevant_articles}）` : "（條號待查證）"}`).join("、")}。`),
    P(`可行做法：${blank(inp.general_food_approach)}`),
    H2("5.2 申請健康食品"), caption("表 5-1 健康食品路徑要求"),
    table(["項目", "內容"], [
      ["保健功效項目", cond.claim_name], ["對應評估方法", `${em.name || "未設定"}${em.announced ? `（${em.announced} 公告）` : ""}${em.url ? `\n${em.url}` : ""}`],
      ["試驗要求重點", em.requirements && em.requirements !== "待填" ? em.requirements : "待維護人員依公告附件填寫"],
      ["現有證據可否支持", blank(inp.hf_support)], ["需補做試驗", blank(inp.extra_trials)],
    ], [1, 3]),
    H2("5.3 原料可用性"), caption("表 5-2 原料可用性"),
    table(["原料或菌種", "可用性", "查核日期"], [
      [c.organism_name, INGREDIENT[rec.regulations.organism?.status || "confirm"], rec.regulations.organism?.checked_at || "未查核"],
      [c.substrate, INGREDIENT[rec.regulations.substrate?.status || "confirm"], rec.regulations.substrate?.checked_at || "未查核"],
    ], [2, 1, 1]),

    H1("第 6 章 證據缺口與建議後續試驗"), caption("表 6-1 證據缺口與建議"),
    table(["缺口", "影響", "建議試驗", "優先順序"], gaps, [3, 3, 3, 1]),

    H1("第 7 章 風險與限制"),
    P("資料範圍：本報告僅依 PMC 開放取用文獻，未涵蓋非開放取用文獻、專利與市場資料。"),
    P(`擷取正確性：表 4-1 中 ${unreviewed} 筆為自動擷取、未經複核。`),
    P(`法規時效：保健功效資料查核日期為 ${rec.regulations.claim_checked_at || "未查核"}。`),
    P(`其他風險：${blank(inp.other_risks)}`),

    H1("簽核"), caption("簽核表"),
    table(["角色", "姓名", "職稱", "簽核日期", "簽章"], [["評估人", blank(inp.evaluator), "", "", ""], ["審核人", blank(inp.reviewer), "", "", ""]], [2, 3, 2, 2, 2]),
    P("聲明", { run: { bold: true }, spacing: { before: 240 } }),
    P("本報告依公開文獻與公開法規資料整理，部分內容由系統自動擷取，已於第 7 章揭露複核狀態。本報告不代表產品功效保證，亦非法規判定或認證結果，僅供研發立案評估使用，未經核准不得對外提供。"),

    H1("附錄 A 完整文獻清單"), caption("表 A-1 文獻清單"),
    table(["編號", "書目", "PMCID", "授權類型", "複核狀態"],
      pmcids.map((p) => [lid[p], `${arts[p]?.first_author || ""} (${arts[p]?.year || ""}). ${arts[p]?.title || ""}. ${arts[p]?.journal || ""}`, p, arts[p]?.license || "unknown",
        byArticle[p].every((f) => f.extraction?.status === "reviewed") ? "已複核" : "自動擷取"]), [6, 50, 12, 10, 10]),
    H1("附錄 B 資料版本"), caption("表 B-1 資料版本"),
    table(["資料", "版本日期", "來源"], [["文獻資料", rec.data_version, "PMC 開放取用子集"], ["法規資料", rec.regulations.claim_checked_at || "未查核", "衛福部食藥署公開資料"], ["排序計算方式", "PIS v0.1", "系統說明文件"]], [1, 1, 2]),
    H1("附錄 C 變更紀錄"), caption("表 C-1 報告變更紀錄"),
    table(["版次", "日期", "修改人", "變更內容"], [["v0.1", nowStr().slice(0, 10), blank(inp.evaluator), "初稿（系統產生）"]], [1, 1, 1, 3]),
  ];

  const headerPara = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
    children: [new TextRun({ text: "發酵資料庫評估報告", size: 18, color: "555555" }),
               new TextRun({ text: `\t${reportNo}　測試版．草稿`, size: 18, color: "A85A12" })],
  });
  const footerPara = new Paragraph({
    tabStops: [{ type: TabStopType.CENTER, position: CONTENT_W / 2 }, { type: TabStopType.RIGHT, position: CONTENT_W }],
    children: [
      new TextRun({ text: "資料分級：內部\t第 ", size: 16, color: "555555" }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "555555" }),
      new TextRun({ text: " 頁／共 ", size: 16, color: "555555" }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "555555" }),
      new TextRun({ text: ` 頁\t產出時間 ${nowStr()}（UTC+8）`, size: 16, color: "555555" }),
    ],
  });

  const doc = new Document({
    creator: "發酵資料庫（測試版）", title: rec.title, description: DISCLAIMER,
    styles: {
      default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 32, bold: true }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: FONT, size: 28, bold: true }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: {
        titlePage: true,
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1134, right: 1134 } },
      },
      headers: { default: new Header({ children: [headerPara] }), first: new Header({ children: [new Paragraph("")] }) },
      footers: { default: new Footer({ children: [footerPara] }), first: new Footer({ children: [new Paragraph("")] }) },
      children: [...cover, ...body],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const name = `${compactDate()}_發酵資料庫_評估報告_v0.1.docx`;
  download(blob, name);
  return name;
}
