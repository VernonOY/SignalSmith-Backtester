export type RSIMode = "oversold" | "overbought";

export interface RSIRule {
  mode: RSIMode;
  threshold: number;
}

export interface Filters {
  sectors?: string[];
  mcap_min?: number;
  mcap_max?: number;
  exclude_tickers?: string[];
}

export interface BacktestRequest {
  strategy: string;
  indicators: Record<string, any>;
  rsi_rule?: RSIRule;
  filters?: Filters;
  universe?: string[];
  start: string;
  end: string;
  capital?: number;
  fee_bps?: number;
}

export interface TimeSeries {
  dates: string[];
  values: number[];
}

export interface Signal {
  date: string;
  type: "buy" | "sell";
  price: number;
  size?: number;
  symbol?: string;
}

export interface Trade {
  enter_date: string;
  enter_price: number;
  exit_date: string;
  exit_price: number;
  pnl: number;
  ret: number;
  symbol?: string;
}

export interface Metrics {
  [k: string]: number;
}

export interface BacktestResponse {
  equity_curve: TimeSeries;
  drawdown_curve: TimeSeries;
  price_series?: TimeSeries;
  signals?: Signal[];
  trades?: Trade[];
  metrics: Metrics;
  universe_size: number;
  trades_count: number;
}

export interface UniverseMeta {
  sectors: string[];
  mcap_buckets: { label: string; min: number; max: number }[];
}
