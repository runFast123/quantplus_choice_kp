import type { Feature } from "./types";

/** Display order and copy for plan features (keys match plans.features). */
export const FEATURE_ROWS: [Feature, string][] = [
  ["watchlist", "Market Radar watchlist"],
  ["research", "Charts, levels and signal history"],
  ["portfolio", "Portfolio and P&L tracking"],
  ["alerts", "Price alerts"],
  ["scanning", "Signal scanning across the market"],
  ["broker_connect", "Broker connections"],
  ["ai_byok", "Bring your own AI key"],
];
