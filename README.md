# 核心外科講堂隨堂測驗

學員填寫姓名、學號，完成五題單選題後交卷。成功畫面只有「你已交卷」。學員 API 不回傳分數、正確答案或解析。

## 網址

- 學員：https://d90019ij.github.io/core-surgery-quiz/
- 講師：https://d90019ij.github.io/core-surgery-quiz/admin.html

講師登入需使用另外交付的隨機管理碼；不會寫進此儲存庫，也不會保存在瀏覽器儲存空間。管理頁可查看姓名、學號、交卷時間、分數、各題作答，匯出 Excel 可開啟的 UTF-8 CSV，並開放或停止收卷。

## 考試規則

- 同一場次、同一學號，只儲存第一份成功交卷的答案。資料庫複合主鍵防止同時送出或換裝置重考。
- 英文字母大小寫、前後空白、全形字元會標準化。學號限 1–32 碼英數字及連字號，不接受中間空白。
- 姓名及學號是自行填寫，沒有身分驗證，無法防止冒用其他學號。這是講師選擇的模式。
- 五題全部必填。未交卷離開可以重新開始；成功交卷後不能改答案或重考。暫停後再開放不會重置紀錄。
- 網路中斷時不會假裝交卷成功；學員可重試，資料庫保證不重複建立或覆寫紀錄。
- 每題等分，五題合計 100 分。評分只在伺服器執行，成績僅提供給持有管理碼的講師。

## 架構與資料保護

`web/` 是 GitHub Pages 靜態網站；`server/` 部署為 Supabase Edge Function；`database/schema.sql` 定義資料表及原子交卷函式。

實際題庫、答案及管理碼只存在私人資料庫與本機 `private/`（已排除 Git）。講義與考題截圖不會上傳 GitHub。所有表格啟用 RLS，撤銷匿名、一般登入角色及 PUBLIC 的存取權；只有伺服器角色能讀取。交卷函式為 SECURITY INVOKER，只有伺服器角色可呼叫。管理碼以 SHA-256 雜湊儲存，原碼為 256-bit 隨機值。

GitHub Pages 只發布 `web/` 內容到 `gh-pages` 分支。不要把整個工作目錄或 `private/` 當成網站上傳。

## 本機開發

需要 Node.js 22.13 以上。沒有第三方執行依賴。

```sh
npm test
npm run check
npm start
```

本機預覽需要另外提供 `private/seed.json`，結構為 `{ settings: { admin_hash, allowed_origins }, exams: [{ id, title, open, questions, answer_key }] }`。每題包含 `id`、`text`、`options`；答案索引由 0 開始。不要提交 seed 或任何真實學員資料。預覽使用本機 SQLite，與正式資料庫隔離，頁面有明顯預覽提示。

## 部署

1. 在獨立 Supabase 專案執行 `database/schema.sql`，透過受保護方式寫入實際題庫、答案及管理碼雜湊。
2. 部署 `server/index.ts` 及其相依檔案為 `core-surgery-quiz` Edge Function。學生端依需求採自填身分，不使用 Supabase 登入，因此平台 `verify_jwt=false`；管理端由函式內的專用管理碼驗證。`SUPABASE_SERVICE_ROLE_KEY` 只能使用伺服器環境預設值。
3. 更新 `web/config.js` 的公開 API 網址與場次編號。在 `core_quiz_settings.allowed_origins` 設定實際網站來源。
4. 將 `web/` 單獨發布至 `gh-pages`，GitHub Pages 來源選擇該分支根目錄。
5. 以獨立測試場次驗證交卷、重複交卷、權限及匯出，避免污染正式成績。

## 下一場考試

新增一筆 `core_quiz_exams`，使用全新的場次 `id`。相同學號在新場次可以作答。學員網址加上 `?exam=新的場次ID`，講師網址亦同。舊成績保留，無需刪除或重設。請勿直接修改已收卷場次的題目或答案。

## 題目來源

器官捐贈與移植課程，依講師提供的五張題目截圖輸入，答案依綠色勾選標記保存。原題文字（包含英文縮寫）保留，未自行改判。2024 年講義僅作課程參考，並未公開發布。

## 驗證

`tests/api.test.mjs` 使用合成題目測試：答案不外洩、伺服器評分、學號標準化、並行防重複、非法答案、講師權限、關閉收卷與來源限制。正式部署另以獨立測試場次及權限查詢驗證資料庫的原子交卷與存取限制。
