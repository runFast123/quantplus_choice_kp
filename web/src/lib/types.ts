// Row shapes for the tables/views the app reads. Mirrors supabase/migrations.
export type PlanCode = "basic" | "pro" | "pro_plus";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "expired" | "cancelled";
export type TenantRole = "owner" | "admin" | "member";
export type TenantType = "personal" | "organization";
export type Exchange = "NSE" | "BSE";
export type BrokerCode = "choice" | "zerodha" | "angelone" | "upstox" | "dhan" | "fyers" | "other";
export type AiProvider = "gemini" | "openai" | "anthropic" | "other";

export type Feature =
  | "watchlist"
  | "research"
  | "portfolio"
  | "alerts"
  | "scanning"
  | "broker_connect"
  | "ai_byok";

export interface Plan {
  code: PlanCode;
  name: string;
  price_paise_yearly: number;
  max_watchlist_symbols: number | null;
  max_portfolio_symbols: number | null;
  features: Partial<Record<Feature, boolean>>;
}

export interface Entitlements {
  tenant_id: string;
  plan_code: PlanCode;
  plan_name: string;
  status: SubscriptionStatus;
  source: string;
  current_period_end: string;
  features: Partial<Record<Feature, boolean>>;
  max_watchlist_symbols: number | null;
  max_portfolio_symbols: number | null;
  watchlist_symbols_used: number;
  portfolio_symbols_used: number;
}

export interface Membership {
  tenant_id: string;
  role: TenantRole;
  tenants: { id: string; name: string; slug: string | null; type: TenantType; status: string };
}

export interface Profile {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  default_tenant_id: string | null;
}

export interface Quote {
  symbol: string;
  exchange: Exchange;
  name: string;
  sector: string | null;
  as_of: string | null;
  last_price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  high_52w: number | null;
  low_52w: number | null;
  rsi: number | null;
  last_signal: "buy" | "exit" | null;
  last_signal_strategy: string | null;
  last_signal_at: string | null;
}

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Holding {
  id: string;
  portfolio_id: string;
  symbol: string;
  exchange: Exchange;
  quantity: number;
  avg_price: number;
  sector: string | null;
  source: "manual" | "broker" | "import";
  created_at: string;
}

export interface Portfolio {
  id: string;
  name: string;
  source: string;
  broker_connection_id: string | null;
  created_at: string;
}

export interface Watchlist {
  id: string;
  name: string;
  created_at: string;
}

export interface WatchlistItem {
  id: string;
  watchlist_id: string;
  symbol: string;
  exchange: Exchange;
  added_at: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  exchange: Exchange;
  condition: "above" | "below";
  trigger_price: number;
  origin: "manual" | "quant_signal";
  channels: string[];
  status: "armed" | "triggered" | "disabled";
  triggered_at: string | null;
  triggered_price: number | null;
  created_at: string;
}

export interface Signal {
  id: number;
  symbol: string;
  exchange: Exchange;
  strategy: string;
  signal_type: "buy" | "exit";
  payload: Record<string, number | string | null>;
  generated_at: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}
