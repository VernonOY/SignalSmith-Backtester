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

const { RangePicker } = DatePicker;
const { Paragraph, Text } = Typography;

const DEFAULT_PRESET_KEY = "backtest-sidebar-preset";
const MIN_DATE = dayjs("2020-01-01");
const LOOKBACK_YEARS = 5;

type IndicatorKey = "rsi" | "macd" | "obv" | "ema" | "adx" | "aroon" | "stoch" | "signals";

type InfoModalKey = IndicatorKey | "strategy" | "execution" | "universe";

const INFO_TITLES: Record<InfoModalKey, string> = {
  strategy: "Strategy Presets",
  execution: "Execution Settings",
  rsi: "Relative Strength Index (RSI)",
  macd: "Moving Average Convergence Divergence (MACD)",
  obv: "On-Balance Volume (OBV)",
  ema: "EMA Crossover",
  adx: "Average Directional Index (ADX)",
  aroon: "Aroon Oscillator",
  stoch: "Stochastic Oscillator",
  signals: "Signal Combination Rules",
  universe: "Universe Filters",
};

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
    };

    await onSubmit(payload);
  };

  const renderInfoContent = (key: InfoModalKey): ReactNode => {
    switch (key) {
      case "strategy":
        return (
          <>
            <Paragraph>
              Strategy presets toggle different indicator combinations to match common trading styles. Selecting a preset only loads default settings — you can still adjust every field afterwards.
            </Paragraph>
            <Paragraph>
              <Text strong>Strategy preset</Text> determines which indicators start enabled:
            </Paragraph>
            <ul>
              <li>
                <Text strong>Mean Reversion</Text> – emphasises buying temporary dips with RSI oversold signals and EMA crossovers.
              </li>
              <li>
                <Text strong>Momentum</Text> – focuses on trend continuation using MACD, OBV, ADX, EMA and the stochastic oscillator.
              </li>
              <li>
                <Text strong>Multifactor</Text> – enables every indicator so you can combine filters for confirmation.
              </li>
            </ul>
            <Paragraph>
              <Text strong>Backtest Range</Text> sets the start and end dates for the analysis. The window must sit between 1 January 2020 and today and may span at most five calendar years. Adjust the period to focus on market regimes or specific events.
            </Paragraph>
          </>
        );
      case "execution":
        return (
          <>
            <Paragraph>
              Execution settings control trade sizing, costs, and exit rules. These choices influence cash usage and the length of each simulated position.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Initial Capital</Text> – starting account value in US dollars; all returns and position sizes are scaled from this figure.
              </li>
              <li>
                <Text strong>Fee (bps)</Text> – round-trip trading cost expressed in basis points (10 bps = 0.10%) applied on both entries and exits.
              </li>
              <li>
                <Text strong>Hold Days</Text> – maximum number of business days to keep a trade open before forcing an exit; it should not exceed the Max Horizon configured in Signal Rules.
              </li>
              <li>
                <Text strong>Stop Loss (%)</Text> – optional downside guard; the trade closes once the loss reaches this percentage.
              </li>
              <li>
                <Text strong>Take Profit (%)</Text> – optional upside target; lock in gains by exiting after this percentage return. Leave both stop and target blank to disable them.
              </li>
            </ul>
          </>
        );
      case "rsi":
        return (
          <>
            <Paragraph>
              The Relative Strength Index (RSI) measures how quickly prices rise versus fall. It oscillates between 0 and 100 and is widely used to spot stretched conditions.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable RSI</Text> – turn the RSI rule on or off when combining indicators.
              </li>
              <li>
                <Text strong>RSI Lookback</Text> – number of days considered when computing RSI; shorter windows react faster but can be noisy.
              </li>
              <li>
                <Text strong>RSI Mode</Text> – choose <em>Oversold</em> to buy when RSI falls below the threshold or <em>Overbought</em> to sell/short when it rises above the threshold.
              </li>
              <li>
                <Text strong>RSI Threshold</Text> – trigger level between 0 and 100. Lower values fire earlier in oversold mode; higher values fire earlier in overbought mode.
              </li>
            </ul>
          </>
        );
      case "macd":
        return (
          <>
            <Paragraph>
              Moving Average Convergence Divergence (MACD) compares fast and slow exponential moving averages to highlight momentum shifts.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable MACD</Text> – include MACD in the signal vote.
              </li>
              <li>
                <Text strong>Fast / Slow</Text> – spans for the short-term and long-term EMAs. Increasing the spans smooths the indicator but reacts more slowly.
              </li>
              <li>
                <Text strong>Signal</Text> – smoothing window for the MACD line used in crossover rules.
              </li>
              <li>
                <Text strong>MACD Rule</Text> – either require the MACD line to cross above its signal line or simply be positive, which favours persistent up-trends.
              </li>
            </ul>
          </>
        );
      case "obv":
        return (
          <>
            <Paragraph>
              On-Balance Volume (OBV) accumulates volume on up days and subtracts it on down days to confirm whether price moves are supported by participation.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable OBV</Text> – include the volume confirmation rule.
              </li>
              <li>
                <Text strong>OBV Rule</Text> – choose between looking for OBV to cross above its moving average (signals fresh accumulation) or simply turn positive.
              </li>
            </ul>
          </>
        );
      case "ema":
        return (
          <>
            <Paragraph>
              The EMA Cross strategy compares short and long exponential moving averages to capture trend direction changes.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable EMA Cross</Text> – activate or deactivate this trend filter.
              </li>
              <li>
                <Text strong>Short</Text> – period for the fast EMA. Smaller numbers hug price closely and react quickly.
              </li>
              <li>
                <Text strong>Long</Text> – period for the slow EMA. Larger spans smooth noise and focus on broader trends.
              </li>
            </ul>
          </>
        );
      case "adx":
        return (
          <>
            <Paragraph>
              Average Directional Index (ADX) quantifies trend strength without regard to direction. Higher values imply a stronger, more directional market.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable ADX</Text> – include the trend-strength filter in the signal mix.
              </li>
              <li>
                <Text strong>Lookback</Text> – number of days used to compute ADX; longer windows smooth the reading.
              </li>
              <li>
                <Text strong>Min ADX</Text> – minimum strength required before signals are considered valid, helping you skip flat markets.
              </li>
            </ul>
          </>
        );
      case "aroon":
        return (
          <>
            <Paragraph>
              The Aroon indicator tracks how recently highs and lows occurred. It helps detect emerging uptrends and fading momentum.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable Aroon</Text> – add the Aroon confirmation step.
              </li>
              <li>
                <Text strong>Lookback</Text> – days considered when evaluating recent highs and lows.
              </li>
              <li>
                <Text strong>Aroon Up / Aroon Down</Text> – thresholds (0-100). Higher Aroon Up demands fresher highs; lower Aroon Down flags weaker down-momentum.
              </li>
            </ul>
          </>
        );
      case "stoch":
        return (
          <>
            <Paragraph>
              The stochastic oscillator compares the latest close with the recent trading range to highlight momentum swings.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Enable Stochastic</Text> – include the oscillator in the signal vote.
              </li>
              <li>
                <Text strong>%K</Text> – primary lookback window; shorter spans react quicker.
              </li>
              <li>
                <Text strong>%D</Text> – smoothing period applied to %K for crossover signals.
              </li>
              <li>
                <Text strong>Threshold</Text> – boundary for oversold/overbought checks when using zone-based rules.
              </li>
              <li>
                <Text strong>Rule</Text> – choose crossovers of %K and %D or focus on oversold/overbought extremes.
              </li>
            </ul>
          </>
        );
      case "signals":
        return (
          <>
            <Paragraph>
              Signal rules define how indicator votes combine into trades and which horizons the backtest evaluates.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Combination Policy</Text> – “Any” fires when one indicator is true, “All” requires unanimous agreement, and “At least k” lets you set the minimum number of agreeing indicators.
              </li>
              <li>
                <Text strong>k</Text> – only used with the “At least k” policy; enter how many indicators must agree.
              </li>
              <li>
                <Text strong>Max Horizon (days)</Text> – longest forward return that will be evaluated. Keep hold days in the Execution section less than or equal to this value.
              </li>
              <li>
                <Text strong>Histogram Horizon (days)</Text> – selects which forward return horizon populates the Return Distribution chart.
              </li>
            </ul>
            <Paragraph>
              Use these settings to balance signal frequency versus confidence and to align trade exits with the analytics you care about.
            </Paragraph>
          </>
        );
      case "universe":
        return (
          <>
            <Paragraph>
              Universe filters control which securities are eligible before any indicators are applied. Refining the universe ensures the strategy focuses on comparable companies.
            </Paragraph>
            <ul>
              <li>
                <Text strong>Sector</Text> – choose one or more industries; leave empty to keep the entire benchmark universe.
              </li>
              <li>
                <Text strong>Market Cap Min / Max</Text> – filter by company size using US dollar values. Set only one bound to create a minimum or maximum constraint.
              </li>
              <li>
                <Text strong>Exclude Tickers</Text> – manually remove individual symbols by typing their ticker codes.
              </li>
            </ul>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <>
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
          filters: {},
        }}
        style={{ padding: "0 16px", height: "100%", overflowY: "auto" }}
      >
        <Card title="Strategy" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <Space style={{ marginBottom: 12 }}>
            <Button type="link" size="small" onClick={() => setActiveInfo("strategy")}>
              Describe Strategy
            </Button>
            <Button type="link" size="small" onClick={() => setActiveInfo("execution")}>
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
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Relative Strength Index (RSI)</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("rsi")}>
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

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Moving Average Convergence Divergence (MACD)</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("macd")}>
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

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>On-Balance Volume (OBV)</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("obv")}>
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

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Exponential Moving Average Cross (EMA)</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("ema")}>
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

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Average Directional Index (ADX)</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("adx")}>
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

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Aroon Oscillator</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("aroon")}>
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

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Stochastic Oscillator</Text>
                <Button type="link" size="small" onClick={() => setActiveInfo("stoch")}>
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
          </Space>
        </Card>

        <Card title="Universe Filters" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <Button type="link" size="small" onClick={() => setActiveInfo("universe")}>
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
            <Button type="link" size="small" onClick={() => setActiveInfo("signals")}>
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
        </Card>

        <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 24 }}>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              Run Backtest
            </Button>
            <Button onClick={handleReset}>Reset</Button>
          </Space>
          <Button onClick={handleSavePreset}>Save Preset</Button>
        </Space>
      </Form>

      <Modal
        open={activeInfo !== null}
        onCancel={() => setActiveInfo(null)}
        footer={null}
        title={activeInfo ? INFO_TITLES[activeInfo] : undefined}
        width={720}
        destroyOnClose
      >
        {activeInfo ? renderInfoContent(activeInfo) : null}
      </Modal>

    </>
  );
};

export default SidebarForm;
