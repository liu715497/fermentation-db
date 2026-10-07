# 變更紀錄

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
