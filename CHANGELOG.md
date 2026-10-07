# 變更紀錄

## 0.3.2（2026-10-07）

- 調節血糖查詢式改用發酵食品用語（fermented、koji、kombucha、natto、kimchi、tempeh、kefir、yogurt、red yeast rice），不再以 ferment*、lactobacill*、bifidobacter* 為條件；試跑時原式抓到的 10 篇最新文獻全部不符合範圍
- 文獻檢索進度顯示 PMC 真正的符合篇數（原本顯示的是取回筆數上限），並固定取回 500 筆後挑最新者
- 不符合範圍的文獻由 AI 附一句原因（exclude_reason），顯示在進度中，方便判斷擷取指示是否過嚴

## 0.3.1（2026-10-07）

- 擷取指示明確定義範圍：需為發酵原料製成的產品，且研究目的與人類健康有關；單純益生菌、酵母粉補充或畜禽飼料研究判為不符
- 擷取指示要求不符時仍輸出 {"findings": [...]} 外層；網站與本機工具也容許模型省略外層（實測 gemini-3.5-flash-lite 會發生，先前造成「缺少 findings 陣列」失敗）
- 組合詳情：同一篇的多個試驗組合併顯示，相同欄位只列一次，不同處（例如劑量）以對照表呈現

## 0.3.0（2026-10-07）

- 新增「文獻檢索」分頁：瀏覽器直接查 PMC，以使用者自選 AI 整理文獻，結果存在該瀏覽器並與共用資料庫合併計分（SW Arch v0.3 流程 D）
- 設定頁新增 NCBI 聯絡信箱、API key 與「測試 PMC 連線」；模型欄位提示改為填 API 模型代碼
- 資料庫為空時，查詢頁改為引導到文獻檢索
- build 另輸出 prompts.json，regulations.json 加入 scoring 與 taxonomy_aliases，供網站使用

## 0.2.0（2026-10-07）

- 網站四個分頁：查詢（含組合詳情與法規路徑）、我的紀錄、報告、設定
- 摘要報告列印成 PDF；正式報告依格式範本產生 Word 草稿（頁首「測試版．草稿」、封面不顯示本所名稱）
- 評估紀錄保存資料快照，支援匯出與匯入
- 使用者自選 AI 草擬報告欄位，送出前顯示內容供確認；金鑰預設僅本次保存
- Word 產生套件 docx 9.9.0 放在 site/vendor（MIT 授權），不從外部網站載入

## 0.1.0（2026-10-07）

- 倉庫骨架、六個法規 YAML 範本（「待填」欄位待維護人員查證）
- 資料處理：fetch、extract、validate、build、submit 與四種 AI 轉接（anthropic、openai、gemini、openai_compatible）
- 單元測試涵蓋 SQA TC-D01～D08、D10、D13、D14
- GitHub Actions：fetch.yml、check.yml、deploy.yml
- 網站為佔位頁，五個分頁於下一版加入
