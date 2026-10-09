# QuantsPulse — Indian Equities Terminal (Chrome Extension)

Real-time Quantitative Signals, Asymmetric Trade Plans & Sentiment Audits docked beside your charts on **TradingView**, **Zerodha Kite**, **Groww**, **Dhan**, and **Angel One**.

---

## 🚀 Quick Install (Load Unpacked in 30 Seconds)

1. Open Google Chrome (or Brave / Edge / Opera).
2. Navigate to `chrome://extensions` in your address bar.
3. In the top right corner, toggle **"Developer mode"** to **ON**.
4. Click the **"Load unpacked"** button in the top left.
5. Select this folder:
   ```
   C:\Users\kaival.trapasia\Desktop\Quantpluse_kp\extension
   ```
6. The extension **"QuantsPulse — Indian Equities Terminal"** will appear in your Chrome toolbar!

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
   - When you switch stocks on the chart, the Side Panel **automatically updates** to show:
     - Active **Buy / Exit strategy signal** (`▲ BUY` / `▼ EXIT`)
     - **Asymmetric Milestone Roadmap**: Stop Loss 1.0R, Target 1 0.75R, Target 2 2.0R, Target 3 3.0R
     - **Key Technical Levels**: SMA 20, SMA 50, SMA 200, 52-Week Range
     - **Sentiment Audit**: RSI 14 score, Alpha Level (`ALPHA TARGET`, `NODE LEVEL 2`, `SENTIMENT PEAK`)
4. **Manual Lookup**:
   - You can also type any NSE symbol (e.g. `RELIANCE`) into the search bar at the top of the side panel at any time.

---

## ⚙️ Development & Server Settings

- By default, the extension connects to the production deployment at `https://quantplus-ten.vercel.app`.
- If testing locally, click the ⚙ settings icon in the top right of the side panel and set the server endpoint to:
  ```
  http://localhost:3000
  ```
- Click **Save**.
