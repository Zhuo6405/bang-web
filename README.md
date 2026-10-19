# BANG! 網頁版

西部槍戰身份卡牌遊戲《BANG!》的網頁實作：3D 酒館牌桌（拔槍射擊動畫）、雲端遊戲伺服器、4–8 人連線或單機對戰 AI（含道奇城、正午、一把卡牌）、聊天與語音。
網站內的「遊玩說明」「規格書」兩個按鈕有完整說明（也在 `src/client/docs/`）。

網址：https://bang.zhuo6405.workers.dev

## 架構

- 前端：React + Three.js（@react-three/fiber），`src/client/`
- 伺服器：Cloudflare Worker + Durable Objects（每個邀請碼一個房間），`src/server/worker.ts`
- 規則引擎與 AI（前後端共用）：`src/engine/`、`src/ai/`、`src/shared/`

## 開發

```bash
npm install
npm run build          # 先建置一次 dist（wrangler 需要）
npm run dev:server     # 本機遊戲伺服器 http://127.0.0.1:8787（也提供建置好的網頁）
npm run dev            # 前端熱更新 http://localhost:5173，/api 與 /ws 轉給 8787
npm test               # 規則測試 + AI 對戰
npx tsx scripts/server-smoke.ts   # 對本機伺服器打一整局
```

## 部署

推送到 `main` 後 GitHub Actions 會測試、建置並部署到 Cloudflare。需要在 repo 的
Settings → Secrets and variables → Actions 設定：

- `CLOUDFLARE_API_TOKEN`：Cloudflare 的 API Token（範本「Edit Cloudflare Workers」）
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 帳號 ID

選填（語音在擋 P2P 的網路也能通）：在 Cloudflare 建立 TURN 金鑰，再用
`npx wrangler secret put TURN_KEY_ID` 與 `npx wrangler secret put TURN_KEY_API_TOKEN` 設定。
