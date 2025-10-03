import { Dayjs } from "dayjs";
import { Filters } from "../types";

type RawSelectionValues = Record<string, any>;

type SelectionRow = [string, string, string | number];

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) {
    if (!value.length) return "—";
    return value.join(", ");
  }
  return String(value);
};

const formatDate = (value?: Dayjs) => (value ? value.format("YYYY-MM-DD") : "—");
const formatBool = (value?: boolean) => (value ? "Enabled" : "Disabled");

export const buildSelectionRows = (values: RawSelectionValues): SelectionRow[] => {
  const rows: SelectionRow[] = [];
  const [start, end] = (values.date ?? []) as [Dayjs | undefined, Dayjs | undefined];
  const filtersValues = (values.filters ?? {}) as Filters & { exclude_tickers?: string[] };

  const addRow = (section: string, label: string, value: unknown) => {
    rows.push([section, label, formatValue(value)]);
  };

  addRow("Strategy", "Strategy", values.strategy);
  addRow("Strategy", "Start date", formatDate(start));
  addRow("Strategy", "End date", formatDate(end));
  addRow("Strategy", "Initial capital", values.capital);
  addRow("Strategy", "Fee (bps)", values.fee_bps);
  addRow("Strategy", "Hold days", values.hold_days);
  addRow("Strategy", "Stop loss (%)", values.stop_loss_pct);
  addRow("Strategy", "Take profit (%)", values.take_profit_pct);

  addRow("Universe Filters", "Sectors", filtersValues.sectors ?? []);
  addRow("Universe Filters", "Market cap min", filtersValues.mcap_min);
  addRow("Universe Filters", "Market cap max", filtersValues.mcap_max);
  addRow("Universe Filters", "Exclude tickers", filtersValues.exclude_tickers ?? []);

  addRow("RSI", "Enabled", formatBool(values.enable_rsi));
  addRow("RSI", "Lookback", values.rsi_n);
  addRow("RSI", "Mode", values.rsi_rule?.mode);
  addRow("RSI", "Threshold", values.rsi_rule?.threshold);

  addRow("MACD", "Enabled", formatBool(values.use_macd));
  addRow("MACD", "Fast", values.macd_fast);
  addRow("MACD", "Slow", values.macd_slow);
  addRow("MACD", "Signal", values.macd_signal);
  addRow("MACD", "Rule", values.macd_rule);

  addRow("OBV", "Enabled", formatBool(values.use_obv));
  addRow("OBV", "Rule", values.obv_rule);

  addRow("EMA", "Enabled", formatBool(values.use_ema));
  addRow("EMA", "Short", values.ema_short);
  addRow("EMA", "Long", values.ema_long);

  addRow("ADX", "Enabled", formatBool(values.use_adx));
  addRow("ADX", "Lookback", values.adx_n);
  addRow("ADX", "Min ADX", values.adx_min);

  addRow("Aroon", "Enabled", formatBool(values.use_aroon));
  addRow("Aroon", "Lookback", values.aroon_n);
  addRow("Aroon", "Aroon up", values.aroon_up);
  addRow("Aroon", "Aroon down", values.aroon_down);

  addRow("Stochastic", "Enabled", formatBool(values.use_stoch));
  addRow("Stochastic", "%K", values.stoch_k);
  addRow("Stochastic", "%D", values.stoch_d);
  addRow("Stochastic", "Threshold", values.stoch_threshold);
  addRow("Stochastic", "Rule", values.stoch_rule);

  addRow("Signal Rules", "Policy", values.policy);
  addRow("Signal Rules", "k", values.policy === "atleast_k" ? values.k : "—");
  addRow("Signal Rules", "Max horizon", values.max_horizon);
  addRow("Signal Rules", "Histogram horizon", values.hist_horizon);
  addRow("Signal Rules", "Histogram bins", values.hist_bins);

  return rows;
};

export default buildSelectionRows;
