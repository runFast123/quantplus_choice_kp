# QuantsPulse — Indian Equities Terminal (Chrome Extension)

End-of-day, rule-based signals, trade plans and key levels for NSE stocks, docked beside your charts on **TradingView**, **Zerodha Kite**, **Groww**, **Dhan**, and **Angel One**. Prices are daily closes, not live ticks. This is research, not investment advice.

---

## 🚀 Quick Install (Load Unpacked in 30 Seconds)

1. Download `quantspulse-terminal.zip` from your QuantsPulse dashboard or website and extract it into a folder.
2. Open Google Chrome (or Brave / Edge / Opera).
3. Navigate to `chrome://extensions` in your address bar.
4. In the top right corner, toggle **"Developer mode"** to **ON**.
5. Click the **"Load unpacked"** button in the top left.
6. Select the extracted folder containing `manifest.json`.
7. The extension **"QuantsPulse — Indian Equities Terminal"** will appear in your Chrome toolbar!

---

## 🔒 Authentication & Account Gating

The QuantsPulse Extension Terminal is exclusively available for active QuantsPulse account holders:

1. **Automatic Session Sync**: Sign in at [quantplus-ten.vercel.app](https://quantplus-ten.vercel.app) in the same Chrome profile. The extension's background worker checks that session (`/api/extension/session`) and keeps a short-lived access token, renewing it before it expires. If the side panel still shows "Account Required", click **Check Login Status**. Signing out on the website signs the extension out the next time a QuantsPulse tab loads.
2. **Locked State for Non-Members**: If you are not signed in or do not possess an account, the on-chart HUD and side panel will show a locked status badge (`🔒 Account Required`) with direct buttons to sign in or start a 3-month free trial. Proprietary trading signals and entry points remain locked on the server until authenticated.

---

## ⚡ How to Use

1. **Pin the Extension**:
   - Click the puzzle icon 🧩 in the Chrome toolbar.
   - Click the pin icon 📌 next to **QuantsPulse**.
2. **Open the Side Panel**:
   - Click the QuantsPulse icon in your toolbar.
   - The native **Side Panel** will open on the right side of your browser.
3. **Chart Anywhere**:
   - Open any chart on [TradingView](https://in.tradingview.com/chart/) (e.g. `NSE:TCS` or `NSE:INFY`).
   - Or open your broker workstation:
     - [Zerodha Kite](https://kite.zerodha.com)
     - [Groww](https://groww.in)
     - [Dhan](https://tv.dhan.co)
     - [Angel One](https://trade.angelone.in)
   - When you switch stocks on the chart, the side panel **automatically updates**. At the top: price, change and a 3-month price line with signal dots (hover it, or focus it and use the arrow keys, to read any day). Below, three tabs:
     - **Signal**: the latest rule signal (`▲ BUY`, `▼ SELL (SHORT)`, `▼ EXIT`, `▲ COVER`), what the rule saw in one sentence, how long ago it fired and how far price has moved since, and the recent signals as a timeline
     - **Plan**: only while the latest signal is a BUY, a price ladder with Stop (−1R), Entry, T1 (+0.75R), T2 (+2R) and T3 (+3R) at their real distances, and where the last close sits
     - **Levels**: SMA 20 / 50 / 200 with how far above or below price is, the 52-week range and RSI (14)
   - Click any price to copy it.
4. **Manual Lookup**:
   - You can also type any NSE symbol (e.g. `RELIANCE`) into the search bar at the top of the side panel at any time.

---

## ⚙️ Development & Server Settings

- By default, the extension connects to the production deployment at `https://quantplus-ten.vercel.app`.
- To test locally, open the extension's **Settings** (gear icon in the side panel, or right-click the toolbar icon → Options) and choose **Local development** (`http://localhost:3000`).
- Only these two servers can be chosen: the extension sends your sign-in token to this server. The on-chart overlay and its style are set on the same page.
