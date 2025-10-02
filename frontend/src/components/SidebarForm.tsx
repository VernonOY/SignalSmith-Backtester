import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Select,
  Slider,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api/client";
import { BacktestRequest, Filters, RSIRule, UniverseMeta } from "../types";
import { downloadCSV } from "../utils/download";

const { RangePicker } = DatePicker;
const { Paragraph, Text } = Typography;

const DEFAULT_PRESET_KEY = "backtest-sidebar-preset";
const MIN_DATE = dayjs("2020-01-01");
const LOOKBACK_YEARS = 5;

type IndicatorKey = "rsi" | "macd" | "obv" | "ema" | "adx" | "aroon" | "stoch" | "signals";

type InfoModalKey = IndicatorKey | "strategy" | "execution" | "universe";

interface SidebarFormProps {
  loading: boolean;
  onSubmit: (payload: BacktestRequest) => Promise<void> | void;
}

const getEarliestAllowed = () => {
  const today = dayjs();
  const candidate = today.subtract(LOOKBACK_YEARS, "year").startOf("day");
  return candidate.isBefore(MIN_DATE) ? MIN_DATE : candidate;
};

const strategyPresets: Record<string, Record<string, unknown>> = {
  mean_reversion: {
    enable_rsi: true,
    use_macd: false,
    use_obv: false,
    use_ema: true,
    use_adx: false,
    use_aroon: false,
    use_stoch: false,
    rsi_rule: { mode: "oversold", threshold: 30 },
  },
  momentum: {
    enable_rsi: false,
    use_macd: true,
    use_obv: true,
    use_ema: true,
    use_adx: true,
    use_aroon: false,
    use_stoch: true,
    stoch_rule: "signal",
    stoch_threshold: 20,
  },
  multifactor: {
    enable_rsi: true,
    use_macd: true,
    use_obv: true,
    use_ema: true,
    use_adx: true,
    use_aroon: true,
    use_stoch: true,
  },
};

const SidebarForm = ({ loading, onSubmit }: SidebarFormProps) => {
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<UniverseMeta>({ sectors: [], mcap_buckets: [] });
  const [activeInfo, setActiveInfo] = useState<InfoModalKey | null>(null);

  const openInfo = (key: InfoModalKey) => {
    setActiveInfo(key);
  };

  const closeInfo = () => {
    setActiveInfo(null);
  };

  useEffect(() => {
    const fetchMeta = async () => {
      try {
        const { data } = await api.get<UniverseMeta>("/universe/meta");
        setMeta(data);
      } catch (error) {
        console.error(error);
      }
    };
    fetchMeta();
  }, []);

  useEffect(() => {
    const preset = localStorage.getItem(DEFAULT_PRESET_KEY);
    if (preset) {
      try {
        const parsed = JSON.parse(preset);
        form.setFieldsValue(parsed);
      } catch (error) {
        console.warn("Invalid preset in storage", error);
      }
    }
  }, [form]);

  const sectorOptions = useMemo(
    () => meta.sectors.map((label) => ({ label, value: label })),
    [meta.sectors]
  );

  const today = dayjs();
  const earliestAllowed = getEarliestAllowed();
  const defaultStart = (() => {
    const oneYearAgo = today.subtract(1, "year");
    return oneYearAgo.isBefore(earliestAllowed) ? earliestAllowed : oneYearAgo;
  })();

  const disabledDate = useCallback((current: Dayjs | null) => {
    if (!current) return false;
    const upperBound = dayjs().endOf("day");
    if (current.isAfter(upperBound)) return true;
    return current.isBefore(earliestAllowed);
  }, [earliestAllowed]);

  const handleReset = () => {
    form.resetFields();
  };

  const handleSavePreset = () => {
    const values = form.getFieldsValue();
    localStorage.setItem(DEFAULT_PRESET_KEY, JSON.stringify(values));
    message.success("Preset saved locally");
  };

  const handleDownloadSelections = () => {
    const values = form.getFieldsValue(true);
    const rows: Array<Array<string | number>> = [];
    const [start, end] = (values.date ?? []) as [Dayjs | undefined, Dayjs | undefined];
    const filtersValues = (values.filters ?? {}) as Filters & {
      exclude_tickers?: string[];
    };

    const addRow = (section: string, label: string, value: unknown) => {
      const normalized = (() => {
        if (value === undefined || value === null || value === "") return "—";
        if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
        return String(value);
      })();
      rows.push([section, label, normalized]);
    };

    const formatDate = (value?: Dayjs) => (value ? value.format("YYYY-MM-DD") : "—");
    const formatBool = (value?: boolean) => (value ? "Enabled" : "Disabled");

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

    downloadCSV("parameter_selection.csv", ["Section", "Parameter", "Value"], rows);
  };

  const handleStrategyChange = (value: string) => {
    const preset = strategyPresets[value];
    if (preset) {
      form.setFieldsValue(preset);
    }
  };

  const maxHorizon = Form.useWatch("max_horizon", form);
  useEffect(() => {
    if (!maxHorizon) return;
    const currentHold = form.getFieldValue("hold_days");
    const currentHist = form.getFieldValue("hist_horizon");
    const next: Record<string, number> = {};
    if (currentHold && currentHold > maxHorizon) {
      next.hold_days = maxHorizon;
    }
    if (currentHist && currentHist > maxHorizon) {
      next.hist_horizon = maxHorizon;
    }
    if (Object.keys(next).length) {
      form.setFieldsValue(next);
    }
  }, [maxHorizon, form]);

  const enableRsi = Form.useWatch("enable_rsi", form) ?? true;
  const useMacd = Form.useWatch("use_macd", form) ?? false;
  const useObv = Form.useWatch("use_obv", form) ?? false;
  const useEma = Form.useWatch("use_ema", form) ?? false;
  const useAdx = Form.useWatch("use_adx", form) ?? false;
  const useAroon = Form.useWatch("use_aroon", form) ?? false;
  const useStoch = Form.useWatch("use_stoch", form) ?? false;

  const submit = async (values: any) => {
    const [start, end] = values.date as [Dayjs, Dayjs];
    const baseFilters = values.filters || {};
    const exclude = (baseFilters.exclude_tickers || [])
      .map((t: string) => t.toUpperCase().trim())
      .filter(Boolean);
    const filters: Filters = {
      sectors: baseFilters.sectors,
      mcap_min: baseFilters.mcap_min,
      mcap_max: baseFilters.mcap_max,
      exclude_tickers: exclude.length ? exclude : undefined,
    };
    const hasFilters = Boolean(
      (filters.sectors && filters.sectors.length) ||
        filters.mcap_min !== undefined ||
        filters.mcap_max !== undefined ||
        (filters.exclude_tickers && filters.exclude_tickers.length)
    );

    const stopLossInput = values.stop_loss_pct;
    const takeProfitInput = values.take_profit_pct;
    const stopLoss = stopLossInput !== undefined && stopLossInput !== null ? stopLossInput / 100 : undefined;
    const takeProfit = takeProfitInput !== undefined && takeProfitInput !== null ? takeProfitInput / 100 : undefined;

    const indicatorsPayload: Record<string, any> = {
      policy: values.policy,
      atleast_k: values.k,
      max_horizon: values.max_horizon,
      hist_horizon: values.hist_horizon,
      hold_days: values.hold_days,
      stop_loss_pct: stopLoss,
      take_profit_pct: takeProfit,
    };

    indicatorsPayload.rsi = enableRsi
      ? {
          use: true,
          n: values.rsi_n,
          rule: values.rsi_rule.mode,
          oversold: values.rsi_rule.mode === "oversold" ? values.rsi_rule.threshold : undefined,
          overbought: values.rsi_rule.mode === "overbought" ? values.rsi_rule.threshold : undefined,
        }
      : { use: false };

    indicatorsPayload.macd = useMacd
      ? {
          use: true,
          fast: values.macd_fast,
          slow: values.macd_slow,
          signal: values.macd_signal,
          rule: values.macd_rule,
        }
      : { use: false };

    indicatorsPayload.obv = useObv
      ? {
          use: true,
          rule: values.obv_rule,
        }
      : { use: false };

    indicatorsPayload.ema = useEma
      ? {
          use: true,
          short: values.ema_short,
          long: values.ema_long,
        }
      : { use: false };

    indicatorsPayload.adx = useAdx
      ? {
          use: true,
          n: values.adx_n,
          min: values.adx_min,
        }
      : { use: false };

    indicatorsPayload.aroon = useAroon
      ? {
          use: true,
          n: values.aroon_n,
          up: values.aroon_up,
          down: values.aroon_down,
        }
      : { use: false };

    indicatorsPayload.stoch = useStoch
      ? {
          use: true,
          k: values.stoch_k,
          d: values.stoch_d,
          rule: values.stoch_rule,
          threshold: values.stoch_threshold,
        }
      : { use: false };

    const payload: BacktestRequest = {
      strategy: values.strategy,
      start: start.format("YYYY-MM-DD"),
      end: end.format("YYYY-MM-DD"),
      indicators: indicatorsPayload,
      rsi_rule: enableRsi ? (values.rsi_rule as RSIRule) : undefined,
      filters: hasFilters ? filters : undefined,
      capital: values.capital,
      fee_bps: values.fee_bps,
      hold_days: values.hold_days,
      stop_loss_pct: stopLoss,
      take_profit_pct: takeProfit,
      hist_bins: values.hist_bins,
    };

    await onSubmit(payload);
  };

  const renderInfoContent = (key: InfoModalKey | null): ReactNode => {
    if (!key) return null;
    switch (key) {
      case "strategy":
        return (
          <>
            <Paragraph>
              Strategy presets load curated indicator blends inspired by common discretionary playbooks. <Text strong>Mean
              Reversion</Text> emphasises RSI extremes and EMA crosses to hunt for prices that have stretched too far from trend.
              <Text strong>Momentum</Text> highlights MACD, OBV, and stochastic agreement to ride persistent directional moves.
              <Text strong>Multifactor</Text> activates every study so you can tune confirmation rules manually. You can always
              adjust any field after selecting a preset to tailor the logic to your preferred style.
            </Paragraph>
            <Paragraph>
              <Text strong>Strategy.</Text> Select the preset to determine which indicators are switched on by default.
            </Paragraph>
            <Paragraph>
              <Text strong>Backtest Range.</Text> Pick start and end dates between 2020-01-01 and today. The span may not exceed five
              calendar years so the test stays within the available history and avoids comparing regimes with materially different
              liquidity or volatility backdrops.
            </Paragraph>
          </>
        );
      case "execution":
        return (
          <>
            <Paragraph>
              <Text strong>Initial Capital.</Text> Defines the cash balance your test begins with. Every position size, return, and
              drawdown is translated into dollars using this amount, so doubling it would double the simulated profits and losses
              while leaving percentage metrics unchanged.
            </Paragraph>
            <Paragraph>
              <Text strong>Fee (bps).</Text> Estimated round-trip trading friction expressed in basis points (1 bp = 0.01%). The
              platform deducts the cost on both entry and exit, meaning that a 25 bp setting shaves 0.25% from each trade’s gross
              performance to mimic commissions and slippage. Higher fees naturally reduce win rates for shorter-term strategies.
            </Paragraph>
            <Paragraph>
              <Text strong>Hold Days.</Text> Caps the lifespan of any open trade. Once this limit is hit, the engine force-closes the
              position at the prevailing price, ensuring that signals which fail to resolve quickly cannot linger and distort
              capital availability for new ideas.
            </Paragraph>
            <Paragraph>
              <Text strong>Stop Loss (%).</Text> Optional protective floor based on percentage drop from entry. Setting this to 5
              means the trade exits if price declines 5%, crystallising a controlled loss and preventing deeper drawdowns during
              volatile swings. Leave blank to disable the safety valve.
            </Paragraph>
            <Paragraph>
              <Text strong>Take Profit (%).</Text> Optional profit target measured from entry. A value of 10 locks in gains once price
              advances 10%, banking momentum-driven wins before they can mean-revert. Leaving the field empty keeps winners running
              until other exit rules intervene.
            </Paragraph>
          </>
        );
      case "rsi":
        return (
          <>
            <Paragraph>
              The Relative Strength Index compares the magnitude of recent gains and losses to spot momentum extremes. Traders
              watch for the oscillator to push into extreme zones (typically below 30 or above 70) as early signals that a swing is
              stretched and may soon revert, a technique popularised by J. Welles Wilder and still widely cited in modern technical
              analysis primers.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable RSI.</Text> Toggles the indicator on or off for signal generation.
            </Paragraph>
            <Paragraph>
              <Text strong>RSI Lookback.</Text> Number of days used when averaging up and down moves. Shorter windows (e.g., 7-14
              periods) react faster to fresh momentum shifts but introduce more whipsaws; longer windows smooth noise at the cost of
              slower turns.
            </Paragraph>
            <Paragraph>
              <Text strong>RSI Mode.</Text> Choose <Text strong>Oversold (&lt;= threshold)</Text> to buy dips or <Text strong>Overbought (&gt;=
              threshold)</Text> to fade rallies.
            </Paragraph>
            <Paragraph>
              <Text strong>RSI Threshold.</Text> Sets the oversold or overbought trigger level (0-100). Lower oversold triggers demand
              heavier pullbacks before acting, while higher overbought triggers wait for exceptionally strong rallies before fading
              them.
            </Paragraph>
          </>
        );
      case "macd":
        return (
          <>
            <Paragraph>
              Moving Average Convergence Divergence (MACD) compares a fast and slow exponential moving average to reveal the
              direction and pace of trend momentum. Histogram flips or signal-line crossovers often flag the transition from
              accumulation to distribution and vice versa.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable MACD.</Text> Include or exclude MACD from the voting process.
            </Paragraph>
            <Paragraph>
              <Text strong>Fast / Slow.</Text> Length of the short- and long-term EMAs that form the MACD line. Wider separation (e.g.,
              12/26) focuses on medium-term swings, whereas tighter spans pick up shorter bursts of momentum but whipsaw more often.
            </Paragraph>
            <Paragraph>
              <Text strong>Signal.</Text> Smoothing period applied to the MACD line. Short values yield quicker crossovers and early
              warnings; longer ones filter noise at the expense of timeliness.
            </Paragraph>
            <Paragraph>
              <Text strong>MACD Rule.</Text> Decide whether a trade triggers when the MACD crosses its signal line—classic momentum
              confirmation—or simply remains above zero to capture periods when the short EMA stays above the long EMA.
            </Paragraph>
          </>
        );
      case "obv":
        return (
          <>
            <Paragraph>
              On-Balance Volume cumulates volume on up days and subtracts it on down days to confirm participation behind price moves.
              Rising OBV alongside price can validate a breakout’s strength, while divergences warn that momentum lacks conviction.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable OBV.</Text> Turn the volume confirmation filter on or off.
            </Paragraph>
            <Paragraph>
              <Text strong>OBV Rule.</Text> Choose between requiring OBV to cross above its moving average (<Text strong>Rise</Text>) or
              simply turn positive (<Text strong>Positive</Text>). The moving-average approach waits for a momentum surge in volume,
              while the positive filter reacts as soon as buying pressure outweighs selling pressure.
            </Paragraph>
          </>
        );
      case "ema":
        return (
          <>
            <Paragraph>
              The EMA crossover looks for shifts in trend when a fast-moving average overtakes a slower one. Many traders treat these
              events as objective evidence that price has shifted regimes because exponential weighting emphasises the latest data.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable EMA Cross.</Text> Toggle whether the crossover contributes to signals.
            </Paragraph>
            <Paragraph>
              <Text strong>Short / Long.</Text> Window length (in days) for the fast and slow EMAs. Short spans track swing trading
              setups with faster, but noisier, reactions; longer spans smooth noise and favour primary trend following.
            </Paragraph>
          </>
        );
      case "adx":
        return (
          <>
            <Paragraph>
              Average Directional Index (ADX) measures the strength of a trend regardless of direction. Values above roughly 25 often
              indicate an established trend, whereas readings below 20 suggest range-bound markets prone to false breakouts.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable ADX.</Text> Adds or removes the trend-strength filter.
            </Paragraph>
            <Paragraph>
              <Text strong>Lookback.</Text> Number of periods used to calculate ADX. Longer lookbacks smooth the reading and avoid
              knee-jerk spikes, while shorter ones adjust faster to fresh surges in directional strength.
            </Paragraph>
            <Paragraph>
              <Text strong>Min ADX.</Text> Minimum value required before signals are allowed. Requiring at least 20–25 helps avoid
              choppy, low-trend environments where breakout systems underperform.
            </Paragraph>
          </>
        );
      case "aroon":
        return (
          <>
            <Paragraph>
              Aroon Up and Down indicate how recently price has made new highs or lows to gauge emerging trends. When Aroon Up stays
              elevated while Aroon Down sinks, the market is consistently printing fresh highs, hinting at bullish control.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable Aroon.</Text> Switch the indicator participation on or off.
            </Paragraph>
            <Paragraph>
              <Text strong>Lookback.</Text> Days inspected when determining recent highs and lows. Larger windows slow the indicator and
              spotlight dominant multi-week trends; smaller windows sharpen its sensitivity to fresh breakouts.
            </Paragraph>
            <Paragraph>
              <Text strong>Aroon Up / Down.</Text> Thresholds (0-100) that define when bullish or bearish momentum is strong enough to
              vote. Higher requirements demand sustained momentum before trades fire, reducing noise but delaying entries.
            </Paragraph>
          </>
        );
      case "stoch":
        return (
          <>
            <Paragraph>
              The stochastic oscillator compares the latest close with the recent high-low range to spot overbought or oversold
              conditions. It highlights moments when price closes near the extreme of its range, signalling potential exhaustion or
              continuation depending on crossovers and threshold rules.
            </Paragraph>
            <Paragraph>
              <Text strong>Enable Stochastic.</Text> Include or exclude the oscillator from the rules.
            </Paragraph>
            <Paragraph>
              <Text strong>%K / %D.</Text> %K controls the base oscillator lookback; %D sets the smoothing applied to %K. Shorter %K
              settings react rapidly to fresh highs or lows, while longer %D smooths the noise and focuses on decisive turns.
            </Paragraph>
            <Paragraph>
              <Text strong>Threshold.</Text> Level used for oversold or overbought checks when those modes are selected. Lower
              thresholds catch deeper pullbacks, whereas higher ones wait for exceptionally strong overbought readings before acting.
            </Paragraph>
            <Paragraph>
              <Text strong>Rule.</Text> Choose between acting on signal-line crossovers or extreme zone tests.
            </Paragraph>
          </>
        );
      case "signals":
        return (
          <>
            <Paragraph>
              <Text strong>Combination Policy.</Text> Defines how many indicators must agree before a trade triggers. <Text strong>Any</Text>
              fires on a single vote, <Text strong>All</Text> requires unanimous agreement, and <Text strong>At least k</Text> lets you set
              the minimum number explicitly.
            </Paragraph>
            <Paragraph>
              <Text strong>k.</Text> Only used when the policy is “At least k”; it specifies the count of confirming indicators needed.
            </Paragraph>
            <Paragraph>
              <Text strong>Max Horizon (days).</Text> Longest forward-return period evaluated. It caps hold days and histogram horizon to
              keep calculations consistent.
            </Paragraph>
            <Paragraph>
              <Text strong>Histogram Horizon (days).</Text> Select which horizon feeds the return distribution chart. It cannot exceed the
              max horizon.
            </Paragraph>
          </>
        );
      case "universe":
        return (
          <>
            <Paragraph>
              Universe filters narrow the list of securities before signals run.
            </Paragraph>
            <Paragraph>
              <Text strong>Sector.</Text> Choose industries to include. Leave empty to consider every available sector.
            </Paragraph>
            <Paragraph>
              <Text strong>Market Cap Min / Max.</Text> Bound the allowable company size in US dollars. Use both boxes to target a
              specific capitalization range.
            </Paragraph>
            <Paragraph>
              <Text strong>Exclude Tickers.</Text> Remove individual symbols (comma or space separated) from consideration regardless of
              other filters.
            </Paragraph>
          </>
        );
      default:
        return null;
    }
  };

  const infoTitles: Record<InfoModalKey, string> = {
    strategy: "Strategy Settings",
    execution: "Execution Settings",
    rsi: "RSI",
    macd: "MACD",
    obv: "On-Balance Volume",
    ema: "EMA Cross",
    adx: "Average Directional Index",
    aroon: "Aroon",
    stoch: "Stochastic Oscillator",
    signals: "Signal Rules",
    universe: "Universe Filters",
  };

  return (
    <>
      <Modal
        open={activeInfo !== null}
        onCancel={closeInfo}
        footer={null}
        title={activeInfo ? infoTitles[activeInfo] : undefined}
        centered
        width={560}
      >
        {renderInfoContent(activeInfo)}
      </Modal>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{
          strategy: "mean_reversion",
          ...strategyPresets.mean_reversion,
          date: [defaultStart, today],
          capital: 100000,
          fee_bps: 1,
          hold_days: 1,
          stop_loss_pct: undefined,
          take_profit_pct: undefined,
          rsi_rule: { mode: "oversold", threshold: 30 },
          rsi_n: 14,
          macd_fast: 12,
          macd_slow: 26,
          macd_signal: 9,
          macd_rule: "signal",
          obv_rule: "rise",
          ema_short: 12,
          ema_long: 26,
          adx_n: 14,
          adx_min: 20,
          aroon_n: 25,
          aroon_up: 70,
          aroon_down: 30,
          stoch_k: 14,
          stoch_d: 3,
          stoch_rule: "signal",
          stoch_threshold: 20,
          policy: "any",
          k: 2,
          max_horizon: 10,
          hist_horizon: 1,
          hist_bins: 20,
          filters: {},
        }}
        style={{ padding: "0 16px", height: "100%", overflowY: "auto" }}
      >
        <Card title="Strategy" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <Space style={{ marginBottom: 12 }}>
            <Button type="link" size="small" onClick={() => openInfo("strategy")}>
              Describe Strategy
            </Button>
            <Button type="link" size="small" onClick={() => openInfo("execution")}>
              Describe Execution
            </Button>
          </Space>
          <Form.Item
            name="strategy"
            label="Strategy"
            rules={[{ required: true }]}
          >
            <Select
              onChange={handleStrategyChange}
              options={[
                { label: "Mean Reversion", value: "mean_reversion" },
                { label: "Momentum", value: "momentum" },
                { label: "Multifactor", value: "multifactor" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="date"
            label="Backtest Range"
            rules={[{ required: true }]}
          >
            <RangePicker allowClear={false} style={{ width: "100%" }} disabledDate={disabledDate} />
          </Form.Item>
          <Form.Item
            label="Initial Capital"
            name="capital"
          >
            <InputNumber min={0} style={{ width: "100%" }} prefix="$" />
          </Form.Item>
          <Space size={12} style={{ width: "100%" }}>
            <Form.Item
              label="Fee (bps)"
              name="fee_bps"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label="Hold Days"
              name="hold_days"
              style={{ flex: 1 }}
            >
              <InputNumber min={1} max={10} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ width: "100%" }}>
            <Form.Item
              label="Stop Loss (%)"
              name="stop_loss_pct"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} placeholder="Optional" />
            </Form.Item>
            <Form.Item
              label="Take Profit (%)"
              name="take_profit_pct"
              style={{ flex: 1 }}
            >
              <InputNumber min={0} max={200} style={{ width: "100%" }} placeholder="Optional" />
            </Form.Item>
          </Space>
        </Card>

        <Card title="Indicators" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <div className="indicator-grid">
            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Relative Strength Index (RSI)</Text>
                <Button type="link" size="small" onClick={() => openInfo("rsi")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable RSI"
                name="enable_rsi"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="RSI Lookback"
                name="rsi_n"
                style={{ marginBottom: 12 }}
              >
                <InputNumber min={2} max={100} style={{ width: "100%" }} disabled={!enableRsi} />
              </Form.Item>
              <Form.Item
                label="RSI Mode"
                name={["rsi_rule", "mode"]}
                style={{ marginBottom: 12 }}
              >
                <Select
                  options={[
                    { label: "Oversold (<= threshold)", value: "oversold" },
                    { label: "Overbought (>= threshold)", value: "overbought" },
                  ]}
                  disabled={!enableRsi}
                />
              </Form.Item>
              <Form.Item
                label="RSI Threshold (0-100)"
                name={["rsi_rule", "threshold"]}
              >
                <Slider min={0} max={100} step={1} disabled={!enableRsi} />
              </Form.Item>
            </div>

            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Moving Average Convergence Divergence (MACD)</Text>
                <Button type="link" size="small" onClick={() => openInfo("macd")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable MACD"
                name="use_macd"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
                <Form.Item
                  label="Fast"
                  name="macd_fast"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item
                  label="Slow"
                  name="macd_slow"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={1} max={40} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item
                  label="Signal"
                  name="macd_signal"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
              </Space>
              <Form.Item
                label="MACD Rule"
                name="macd_rule"
              >
                <Select
                  options={[
                    { label: "Signal Crossover", value: "signal" },
                    { label: "MACD > 0", value: "positive" },
                  ]}
                  disabled={!useMacd}
                />
              </Form.Item>
            </div>

            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>On-Balance Volume (OBV)</Text>
                <Button type="link" size="small" onClick={() => openInfo("obv")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable OBV"
                name="use_obv"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="OBV Rule"
                name="obv_rule"
              >
                <Select
                  options={[
                    { label: "OBV crosses above its moving average", value: "rise" },
                    { label: "OBV turns positive", value: "positive" },
                  ]}
                  disabled={!useObv}
                />
              </Form.Item>
            </div>

            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Exponential Moving Average Cross (EMA)</Text>
                <Button type="link" size="small" onClick={() => openInfo("ema")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable EMA Cross"
                name="use_ema"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item
                  label="Short"
                  name="ema_short"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={2} max={50} style={{ width: "100%" }} disabled={!useEma} />
                </Form.Item>
                <Form.Item
                  label="Long"
                  name="ema_long"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={5} max={200} style={{ width: "100%" }} disabled={!useEma} />
                </Form.Item>
              </Space>
            </div>

            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Average Directional Index (ADX)</Text>
                <Button type="link" size="small" onClick={() => openInfo("adx")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable ADX"
                name="use_adx"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item
                  label="Lookback"
                  name="adx_n"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAdx} />
                </Form.Item>
                <Form.Item
                  label="Min ADX"
                  name="adx_min"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={5} max={60} style={{ width: "100%" }} disabled={!useAdx} />
                </Form.Item>
              </Space>
            </div>

            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Aroon Oscillator</Text>
                <Button type="link" size="small" onClick={() => openInfo("aroon")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable Aroon"
                name="use_aroon"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item
                  label="Lookback"
                  name="aroon_n"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item
                  label="Aroon Up"
                  name="aroon_up"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item
                  label="Aroon Down"
                  name="aroon_down"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
              </Space>
            </div>

            <div className="indicator-grid__item">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Stochastic Oscillator</Text>
                <Button type="link" size="small" onClick={() => openInfo("stoch")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable Stochastic"
                name="use_stoch"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
                <Form.Item
                  label="%K"
                  name="stoch_k"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item
                  label="%D"
                  name="stoch_d"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item
                  label="Threshold"
                  name="stoch_threshold"
                  style={{ flex: 1, marginBottom: 0 }}
                >
                  <InputNumber min={1} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
              </Space>
              <Form.Item
                label="Rule"
                name="stoch_rule"
              >
                <Select
                  options={[
                    { label: "Signal crossover", value: "signal" },
                    { label: "Oversold", value: "oversold" },
                    { label: "Overbought", value: "overbought" },
                  ]}
                  disabled={!useStoch}
                />
              </Form.Item>
            </div>
          </div>
        </Card>

        <Card title="Universe Filters" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <Button type="link" size="small" onClick={() => openInfo("universe")}>
              Describe
            </Button>
          </div>
          <Form.Item label="Sector" name={["filters", "sectors"]} extra="Pick industries to include.">
            <Select mode="multiple" allowClear options={sectorOptions} />
          </Form.Item>
          <Form.Item label="Market Cap Min ($)" name={["filters", "mcap_min"]} extra="Smallest allowed market capitalization.">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Market Cap Max ($)" name={["filters", "mcap_max"]} extra="Largest allowed market capitalization.">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Exclude Tickers"
            name={["filters", "exclude_tickers"]}
            extra="Remove specific symbols (comma or space separated)."
          >
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder="e.g. TSLA, NVDA" />
          </Form.Item>
        </Card>

        <Card title="Signal Rules" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <Button type="link" size="small" onClick={() => openInfo("signals")}>
              Describe
            </Button>
          </div>
          <Form.Item
            label="Combination Policy"
            name="policy"
          >
            <Select
              options={[
                { label: "Any", value: "any" },
                { label: "All", value: "all" },
                { label: "At least k", value: "atleast_k" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="k"
            name="k"
          >
            <InputNumber min={1} max={7} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Max Horizon (days)"
            name="max_horizon"
          >
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Histogram Horizon (days)"
            name="hist_horizon"
          >
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Histogram Bins"
            name="hist_bins"
            extra="Number of buckets when summarising forward returns."
          >
            <InputNumber min={5} max={60} style={{ width: "100%" }} />
          </Form.Item>
        </Card>

        <Space
          style={{ width: "100%", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}
        >
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              Run Backtest
            </Button>
            <Button onClick={handleReset}>Reset</Button>
          </Space>
          <Space>
            <Button onClick={handleDownloadSelections}>Download Selection</Button>
            <Button onClick={handleSavePreset}>Save Preset</Button>
          </Space>
        </Space>
      </Form>

    </>
  );
};

export default SidebarForm;
