import type { Feature } from "./types";

/** Display order and copy for plan features (keys match plans.features). */
export const FEATURE_ROWS: [Feature, string][] = [
  ["watchlist", "Market Radar watchlist"],
  ["research", "Charts, levels and signal history"],
  ["portfolio", "Portfolio and P&L tracking"],
  ["alerts", "Price alerts"],
  ["scanning", "Signal scanning across the market"],
  ["ai_byok", "Bring your own AI key"],
  ["head_start", "Am I too late? How far a stock has run, against the rules' tested trades"],
  ["behaviour_mirror", "Your trading habits, read from your own trades"],
  ["stay_in", "Stay-in Plan: hold a trend until it closes below its 200-day average, with a message"],
];
