# 發酵資料庫（測試版）

依文獻證據與法規路徑，協助收斂發酵產品研發題目的查詢工具。測試版只含「調節血糖」一項保健功效。

規格文件：MRS v1.0、PES v1.0、SW Arch v0.2、PIS v0.1、SQA v0.1（Claude 文件，連結見專案紀錄）。

> 本倉庫為公開倉庫。只放公開文獻的書目與擷取欄位、公開法規資訊；不得放入文獻全文、金鑰、客戶或未公開資料。

## 資料夾

```text
data/regulations/   人工維護的法規資料（可在 GitHub 網頁直接編輯）
data/literature/    文獻書目、候選清單、擷取結果（自動產生，勿手動修改；reviewed.yaml 除外）
data/build/         網站資料檔（自動產生）
pipeline/           資料處理程式
site/               網站（純 HTML、CSS、JavaScript；vendor/ 內為 Word 產生套件 docx 9.9.0，MIT 授權）
tests/              單元測試
.github/workflows/  自動化流程
```

## 安裝（擷取負責人本機）

需 Python 3.12 以上與 git。

```bash
pip install -r requirements-dev.txt
pip install -e .            # 選用：安裝後可用 fdb 指令，等同 python -m pipeline
cp .env.example .env        # 填入 AI 服務、模型、金鑰、EXTRACTOR、NCBI_EMAIL
```

## 指令

| 指令 | 用途 | 在哪裡跑 |
| --- | --- | --- |
| `python -m pipeline fetch --claim glycemic` | 查詢 PMC，更新候選清單與書目 | GitHub Actions（也可本機） |
| `python -m pipeline extract --claim glycemic --limit 20` | 用 .env 設定的 AI 擷取，分批處理，可中斷續跑 | 本機 |
| `python -m pipeline validate [--strict]` | 檢核所有資料；`--strict` 時「待填」視為錯誤（上線前用） | 兩處 |
| `python -m pipeline build` | 產生 data/build/*.json | GitHub Actions |
| `python -m pipeline submit` | 擷取結果推到新分支並開合併請求 | 本機 |
| `python -m pytest -q` | 單元測試 | 兩處 |

## 一次擷取的流程

1. 在 GitHub「Actions → 文獻抓取」按 Run workflow（或等每季自動執行），合併它開的合併請求。
2. 本機 `git pull`，執行 `python -m pipeline extract --limit 10` 試跑，人工核對 10 篇。
3. 沒問題後分批執行到全部完成；失敗的文獻記在 `data/literature/failed.yaml`，重跑會再試。
4. `python -m pipeline submit`，到 GitHub 確認合併請求的檢核通過後合併，網站自動更新。

## GitHub 設定（一次性）

- Settings → Pages → Source 選 **GitHub Actions**。
- Settings → Secrets and variables → Actions → **Variables** 新增 `NCBI_EMAIL`（非機密，所以放在 Variables，不用 Secrets）。
- Settings → Code security → 開啟 **Secret scanning**。
- Settings → Actions → General → Workflow permissions 勾選「Allow GitHub Actions to create and approve pull requests」（fetch 流程開合併請求需要）。

## 網站

部署後以 GitHub Pages 網址開啟，不需安裝或登入。五個分頁：

| 分頁 | 功能 |
| --- | --- |
| 文獻檢索 | 直接從 PMC 找最新開放取用文獻，用使用者在「設定」選的 AI 逐篇整理；結果只存在該瀏覽器，標示「即時檢索、未複核」 |
| 查詢 | 依保健功效、產品型態、原料偏好、排除原料、證據等級篩選組合；點組合看文獻、法規路徑，並可存為評估紀錄 |
| 我的紀錄 | 評估紀錄列表、勾選 2～5 筆並列比較、匯出與匯入紀錄檔 |
| 報告 | 填寫評估人欄位、AI 草擬（選用）、列印摘要報告成 PDF、下載正式報告 Word 草稿 |
| 設定 | 選 AI 服務與模型（填 API 模型代碼，例如 gemini-3.5-flash-lite）、輸入金鑰（預設關閉分頁即清除）、測試 AI 與 PMC 連線 |

評估紀錄、即時檢索結果與金鑰只存在使用者自己的瀏覽器。網站只連到 NCBI（PMC 查詢）與使用者選的 AI 服務，不載入任何外部程式或字型；Word 產生套件放在 `site/vendor/`，按下載時才載入。

本機預覽（需先有 data/build 資料）：

```bash
python -m pipeline build
mkdir -p _site/data && cp -r site/. _site/ && cp data/build/*.json _site/data/
python -m http.server 8000 --directory _site   # 瀏覽器開 http://localhost:8000
```

即時檢索與共用資料庫可以並存：共用資料庫由 `pipeline` 建置（每季、經人工複核），即時檢索結果在瀏覽器內與它合併，用同一套規則計分（`site/js/rules.js` 與 `pipeline/scoring.py` 須同步修改）。擷取指示只有一份範本：`pipeline/prompts/extract_template.md`，build 時依各保健功效設定產生 `prompts.json` 供網站使用。

## 文獻檢索參數（v0.5.0）

| 參數 | 何時套用 | 說明 |
| --- | --- | --- |
| 關鍵字：必須包含、任一包含、排除 | PMC 查詢 | 逗號分隔；片語直接輸入 |
| 發表年份 | PMC 查詢 | 以 `[pdat]` 篩選 |
| 文章類型、最少被引用數、期刊指標下限 | 送 AI 前 | 資料來自 OpenAlex；查無資料的文獻不受這兩項數值篩選排除 |
| 處理順序 | 送 AI 前 | 人體試驗優先、最新收錄、被引用數最高、期刊指標最高 |
| 進階查詢式 | PMC 查詢 | 填寫後取代自動產生的查詢式 |

建議用法：按「預覽並勾選文獻」列出篩選結果（不花 AI 費用），逐篇「看摘要」後只勾選值得分析的文獻，再按「分析勾選的 N 篇」。

期刊指標是 OpenAlex 的 2 年平均被引用數，仿照 IF 計算，不是 Clarivate 的 IF。Clarivate IF 為付費授權資料，不得放入本公開倉庫。

## 新增保健功效

新增一項保健功效只需編輯 `data/regulations/health_claims.yaml`，不用改程式。複製調節血糖那一段，修改以下欄位：

| 欄位 | 說明 | 範例（調節血脂） |
| --- | --- | --- |
| `code` | 英文代碼，建立後不要再改 | `lipid` |
| `target` | 應用對象：`human`（人類食品）或 `animal`（畜禽與水產飼料）；決定證據等級對應、擷取範圍與法規路徑 | `human` |
| `name_zh` | 中文名稱，顯示在網站 | 調節血脂 |
| `enabled` | 是否在網站開放；查證完成前可先設 `false` | `true` |
| `focus` | 擷取主題，會帶入給 AI 的指示 | 發酵產品對血脂調節 |
| `outcomes` | 評估指標的英文代碼與中文名稱，最後一項固定為 `other` | `{code: tg, name_zh: 三酸甘油酯}` |
| `human_trial_required` | 健康食品評估方法是否只採人體試驗；未查證填 `待填` | `待填` |
| `evidence_note` | 顯示在法規路徑的一句說明，選填 | |
| `prompt_notes` | 給 AI 的此項專屬補充說明，選填 | 血脂指標須為血清或血漿數值 |
| `evaluation_method` | 評估方法名稱、公告日期、連結、試驗要求 | |
| `search_query` | PMC 查詢式，建議沿用調節血糖的發酵食品用語，只換功效用語 | |

所有功效共用同一份擷取指示範本 `pipeline/prompts/extract_template.md`，`focus`、`outcomes`、`prompt_notes` 會自動填入。存檔後 GitHub 會自動檢核（例如指標代碼重複、缺少 `other`），通過後重新部署，網站的查詢與文獻檢索就會出現新的功效。

上線前請執行 `python -m pipeline validate --strict`，確認沒有「待填」欄位。

## 驗證狀態

已驗證（2026-10-07，於開發環境執行）：

- 37 個單元測試全部通過，含「只改設定檔即可新增保健功效」的 5 個測試，以及被引用數、期刊指標計分與 OpenAlex 查詢解析，含 SQA TC-D01～D08、D10、D13、D14 與四種 AI 轉接的請求格式。
- `validate` 與 `build` 對目前的範本資料可正常執行。
- 文獻檢索以模擬的 PMC 與 AI 回應在 Chromium 實測：查詢、授權不明略過、AI 輸出格式錯誤時自動重試、結果寫入瀏覽器並出現在查詢排名、重複執行時略過已檢索的文獻、停止按鈕與清除結果。
- 網站計分（rules.js）與 pipeline 計分在示範資料上 5 個組合分數完全一致。
- Gemini（gemini-3.5-flash-lite）可由瀏覽器直接呼叫（2026-10-07 使用者實測「測試連線」成功）。
- 網站以虛構示範資料在 Chromium 實測：查詢與四種篩選、查無結果提示、組合詳情、存紀錄、並列比較、匯出紀錄、摘要報告列印、正式報告 Word 下載（以 LibreOffice 開啟確認章節與頁首頁尾）、金鑰預設僅本次保存與清除；手機寬度版面正常；過程無 JavaScript 錯誤。

尚未驗證（開發環境無法連到 NCBI 與 AI 服務）：

- `fetch` 實際連線 NCBI E-utilities，及 efetch 回傳的 JATS 授權欄位解析。
- `extract` 實際呼叫 Claude 與 BioC API 取得全文。
- 三個 GitHub Actions 流程（需在倉庫上執行一次）。
- 瀏覽器呼叫 NCBI E-utilities：2026-10-07 使用者實測「測試 PMC 連線」成功。
- 瀏覽器呼叫 OpenAlex 與 PMC esummary：以模擬回應測試，尚待部署後按設定頁「測試 OpenAlex 連線」實測。
- 網站「AI 草擬」、文獻檢索實際呼叫 Claude、OpenAI、地端模型（Gemini 已實測連線）。
- 正式報告在 Microsoft Word 中的字型（標楷體）顯示；開發環境以 LibreOffice 檢查，該環境沒有標楷體。

## 待查證

- BioC API 網址格式：`pipeline/ncbi.py` 的 `BIOC_URL`，請對照 NCBI BioC API 官方說明。
- NCBI 請求頻率上限：程式採保守間隔（無 API key 0.4 秒、有 key 0.15 秒），請依 E-utilities 官方說明確認。
- 文獻挑選規則：查詢結果以 PMC 編號由大到小取前 200 篇，近似「最近收錄」；查詢命中超過 10,000 篇時只會從前 10,000 筆中挑選。
- Claude 從瀏覽器呼叫需加 `anthropic-dangerous-direct-browser-access` 標頭（已加），尚未實測。
- Actions 版本（checkout@v4、setup-python@v5、upload-pages-artifact@v3、deploy-pages@v4、create-pull-request@v7）為撰寫時版本，可用 Dependabot 更新。
