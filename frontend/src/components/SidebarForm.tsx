import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Form,
  InputNumber,
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

type InfoModalKey = IndicatorKey | "strategy" | "execution";

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

const infoPanelStyle: CSSProperties = {
  background: "#f5f5f5",
  padding: 12,
  borderRadius: 6,
  marginBottom: 12,
};

const SidebarForm = ({ loading, onSubmit }: SidebarFormProps) => {
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<UniverseMeta>({ sectors: [], mcap_buckets: [] });
  const [expandedInfo, setExpandedInfo] = useState<null | InfoModalKey>(null);

  const toggleInfo = (key: InfoModalKey) => {
    setExpandedInfo((prev) => (prev === key ? null : key));
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
              Strategy presets simply pre-fill indicator toggles. “Mean Reversion” focuses on RSI and EMA crossovers, “Momentum”
              enables MACD / OBV / Stochastic, and “Multifactor” activates every indicator so you can fine-tune thresholds
              yourself. You may adjust any setting after choosing a preset.
            </Paragraph>
          </>
        );
      case "execution":
        return (
          <>
            <Paragraph>
              Hold days determine how long each trade remains open before the platform forces an exit. Stop-loss and take-profit
              inputs apply percentage limits to every trade, while fees (basis points) deduct costs on both entry and exit.
              Adjust these controls to mirror your real-world trading friction.
            </Paragraph>
          </>
        );
      case "rsi":
        return (
          <>
            <Paragraph>
              The Relative Strength Index measures average gains versus losses over the lookback window. Oversold mode hunts for
              rebounds below the threshold, while overbought mode fades rallies above the threshold.
            </Paragraph>
          </>
        );
      case "macd":
        return (
          <>
            <Paragraph>
              MACD subtracts a slow EMA from a fast EMA to highlight momentum shifts. The signal-span smooths the difference; use
              the rule control to decide between signal-line crossovers or simply MACD &gt; 0.
            </Paragraph>
          </>
        );
      case "obv":
        return (
          <>
            <Paragraph>
              On-Balance Volume cumulates volume on up days and subtracts it on down days. It confirms whether price trends are
              supported by rising participation.
            </Paragraph>
          </>
        );
      case "ema":
        return (
          <>
            <Paragraph>
              EMA Cross compares a short-term and long-term exponential moving average. When the short EMA rises above the long
              EMA, it suggests a potential trend change.
            </Paragraph>
          </>
        );
      case "adx":
        return (
          <>
            <Paragraph>
              Average Directional Index quantifies trend strength. Requiring ADX above a minimum value helps you avoid flat
              markets.
            </Paragraph>
          </>
        );
      case "aroon":
        return (
          <>
            <Paragraph>
              Aroon Up and Down track how recently highs and lows occurred. Raising the up-threshold emphasises fresh highs;
              lowering the down-threshold highlights fading momentum.
            </Paragraph>
          </>
        );
      case "stoch":
        return (
          <>
            <Paragraph>
              The stochastic oscillator compares the latest close to the range of prices observed during the lookback window.
              Configure %K/%D spans and decide whether to act on signal-line crossovers or extreme zones.
            </Paragraph>
          </>
        );
      case "signals":
        return (
          <>
            <Paragraph>
              Combination policy defines how individual indicators vote together. “Any” fires when one indicator is true, “All”
              requires unanimous agreement, and “At least k” lets you specify the minimum number of agreeing indicators. The
              histogram horizon and hold days must never exceed the maximum horizon input.
            </Paragraph>
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
            <Button type="link" size="small" onClick={() => toggleInfo("strategy")}>
              {expandedInfo === "strategy" ? "Hide Strategy Guide" : "Describe Strategy"}
            </Button>
            <Button type="link" size="small" onClick={() => toggleInfo("execution")}>
              {expandedInfo === "execution" ? "Hide Execution Guide" : "Describe Execution"}
            </Button>
          </Space>
          {expandedInfo === "strategy" && <div style={infoPanelStyle}>{renderInfoContent("strategy")}</div>}
          {expandedInfo === "execution" && <div style={infoPanelStyle}>{renderInfoContent("execution")}</div>}
          <Form.Item
            name="strategy"
            label="Strategy"
            rules={[{ required: true }]}
            extra={
              expandedInfo === "strategy"
                ? "Choose a preset to pre-fill indicator switches."
                : undefined
            }
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
            extra={
              expandedInfo === "strategy"
                ? "Pick dates between 2020-01-01 and today; the span may not exceed five calendar years."
                : undefined
            }
          >
            <RangePicker allowClear={false} style={{ width: "100%" }} disabledDate={disabledDate} />
          </Form.Item>
          <Form.Item
            label="Initial Capital"
            name="capital"
            extra={
              expandedInfo === "execution" ? "Starting portfolio value in US dollars." : undefined
            }
          >
            <InputNumber min={0} style={{ width: "100%" }} prefix="$" />
          </Form.Item>
          <Space size={12} style={{ width: "100%" }}>
            <Form.Item
              label="Fee (bps)"
              name="fee_bps"
              style={{ flex: 1 }}
              extra={
                expandedInfo === "execution"
                  ? "Basis points charged on both entry and exit (10 bps = 0.10%)."
                  : undefined
              }
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label="Hold Days"
              name="hold_days"
              style={{ flex: 1 }}
              extra={
                expandedInfo === "execution"
                  ? "Maximum number of business days to keep each trade open."
                  : undefined
              }
            >
              <InputNumber min={1} max={10} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ width: "100%" }}>
            <Form.Item
              label="Stop Loss (%)"
              name="stop_loss_pct"
              style={{ flex: 1 }}
              extra={
                expandedInfo === "execution"
                  ? "Optional downside limit per trade (e.g. 5 = -5%). Leave blank for none."
                  : undefined
              }
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} placeholder="Optional" />
            </Form.Item>
            <Form.Item
              label="Take Profit (%)"
              name="take_profit_pct"
              style={{ flex: 1 }}
              extra={
                expandedInfo === "execution"
                  ? "Optional upside cap per trade (e.g. 10 = +10%). Leave blank for none."
                  : undefined
              }
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
                <Button type="link" size="small" onClick={() => toggleInfo("rsi")}>
                  {expandedInfo === "rsi" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "rsi" && <div style={infoPanelStyle}>{renderInfoContent("rsi")}</div>}
              <Form.Item
                label="Enable RSI"
                name="enable_rsi"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "rsi" ? "Toggle the RSI oscillator." : undefined}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="RSI Lookback"
                name="rsi_n"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "rsi" ? "Number of days used in the RSI calculation." : undefined}
              >
                <InputNumber min={2} max={100} style={{ width: "100%" }} disabled={!enableRsi} />
              </Form.Item>
              <Form.Item
                label="RSI Mode"
                name={["rsi_rule", "mode"]}
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "rsi" ? "Choose oversold (buy dips) or overbought (fade rallies)." : undefined}
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
                extra={
                  expandedInfo === "rsi"
                    ? "Lower values trigger earlier in oversold mode; higher values trigger earlier in overbought mode."
                    : undefined
                }
              >
                <Slider min={0} max={100} step={1} disabled={!enableRsi} />
              </Form.Item>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Moving Average Convergence Divergence (MACD)</Text>
                <Button type="link" size="small" onClick={() => toggleInfo("macd")}>
                  {expandedInfo === "macd" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "macd" && <div style={infoPanelStyle}>{renderInfoContent("macd")}</div>}
              <Form.Item
                label="Enable MACD"
                name="use_macd"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "macd" ? "Toggle MACD on or off." : undefined}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
                <Form.Item
                  label="Fast"
                  name="macd_fast"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "macd" ? "Fast EMA span." : undefined}
                >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item
                  label="Slow"
                  name="macd_slow"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "macd" ? "Slow EMA span." : undefined}
                >
                  <InputNumber min={1} max={40} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item
                  label="Signal"
                  name="macd_signal"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "macd" ? "Signal-line smoothing period." : undefined}
                >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
              </Space>
              <Form.Item
                label="MACD Rule"
                name="macd_rule"
                extra={
                  expandedInfo === "macd"
                    ? "Choose signal-line crossover or MACD > 0 as the trigger."
                    : undefined
                }
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
                <Button type="link" size="small" onClick={() => toggleInfo("obv")}>
                  {expandedInfo === "obv" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "obv" && <div style={infoPanelStyle}>{renderInfoContent("obv")}</div>}
              <Form.Item
                label="Enable OBV"
                name="use_obv"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "obv" ? "Toggle OBV on or off." : undefined}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="OBV Rule"
                name="obv_rule"
                extra={
                  expandedInfo === "obv"
                    ? "Decide between OBV crossing its moving average (rise) or turning positive."
                    : undefined
                }
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
                <Button type="link" size="small" onClick={() => toggleInfo("ema")}>
                  {expandedInfo === "ema" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "ema" && <div style={infoPanelStyle}>{renderInfoContent("ema")}</div>}
              <Form.Item
                label="Enable EMA Cross"
                name="use_ema"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "ema" ? "Toggle the EMA cross strategy." : undefined}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item
                  label="Short"
                  name="ema_short"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "ema" ? "Short-term EMA span." : undefined}
                >
                  <InputNumber min={2} max={50} style={{ width: "100%" }} disabled={!useEma} />
                </Form.Item>
                <Form.Item
                  label="Long"
                  name="ema_long"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "ema" ? "Long-term EMA span." : undefined}
                >
                  <InputNumber min={5} max={200} style={{ width: "100%" }} disabled={!useEma} />
                </Form.Item>
              </Space>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Average Directional Index (ADX)</Text>
                <Button type="link" size="small" onClick={() => toggleInfo("adx")}>
                  {expandedInfo === "adx" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "adx" && <div style={infoPanelStyle}>{renderInfoContent("adx")}</div>}
              <Form.Item
                label="Enable ADX"
                name="use_adx"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "adx" ? "Toggle the ADX trend-strength filter." : undefined}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item
                  label="Lookback"
                  name="adx_n"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "adx" ? "Lookback length." : undefined}
                >
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAdx} />
                </Form.Item>
                <Form.Item
                  label="Min ADX"
                  name="adx_min"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "adx" ? "Minimum ADX value." : undefined}
                >
                  <InputNumber min={5} max={60} style={{ width: "100%" }} disabled={!useAdx} />
                </Form.Item>
              </Space>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Aroon Oscillator</Text>
                <Button type="link" size="small" onClick={() => toggleInfo("aroon")}>
                  {expandedInfo === "aroon" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "aroon" && <div style={infoPanelStyle}>{renderInfoContent("aroon")}</div>}
              <Form.Item
                label="Enable Aroon"
                name="use_aroon"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "aroon" ? "Toggle the Aroon indicator." : undefined}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item
                  label="Lookback"
                  name="aroon_n"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "aroon" ? "Lookback days." : undefined}
                >
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item
                  label="Aroon Up"
                  name="aroon_up"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "aroon" ? "Upper threshold." : undefined}
                >
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item
                  label="Aroon Down"
                  name="aroon_down"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "aroon" ? "Lower threshold." : undefined}
                >
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
              </Space>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Stochastic Oscillator</Text>
                <Button type="link" size="small" onClick={() => toggleInfo("stoch")}>
                  {expandedInfo === "stoch" ? "Hide Details" : "Describe"}
                </Button>
              </div>
              {expandedInfo === "stoch" && <div style={infoPanelStyle}>{renderInfoContent("stoch")}</div>}
              <Form.Item
                label="Enable Stochastic"
                name="use_stoch"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra={expandedInfo === "stoch" ? "Toggle the stochastic oscillator." : undefined}
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
                <Form.Item
                  label="%K"
                  name="stoch_k"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "stoch" ? "%K lookback." : undefined}
                >
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item
                  label="%D"
                  name="stoch_d"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "stoch" ? "%D smoothing." : undefined}
                >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item
                  label="Threshold"
                  name="stoch_threshold"
                  style={{ flex: 1, marginBottom: 0 }}
                  extra={expandedInfo === "stoch" ? "Threshold for oversold/overbought." : undefined}
                >
                  <InputNumber min={1} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
              </Space>
              <Form.Item
                label="Rule"
                name="stoch_rule"
                extra={
                  expandedInfo === "stoch"
                    ? "Decide between signal crossover, oversold, or overbought triggers."
                    : undefined
                }
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
            <Button type="link" size="small" onClick={() => toggleInfo("signals")}>
              {expandedInfo === "signals" ? "Hide Details" : "Describe"}
            </Button>
          </div>
          {expandedInfo === "signals" && <div style={infoPanelStyle}>{renderInfoContent("signals")}</div>}
          <Form.Item
            label="Combination Policy"
            name="policy"
            extra={
              expandedInfo === "signals"
                ? "Decide how indicator votes combine."
                : undefined
            }
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
            extra={
              expandedInfo === "signals" ? "Minimum agreeing indicators when using 'At least k'." : undefined
            }
          >
            <InputNumber min={1} max={7} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Max Horizon (days)"
            name="max_horizon"
            extra={
              expandedInfo === "signals"
                ? "Longest forward-return horizon to compute (also bounds hold days)."
                : undefined
            }
          >
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="Histogram Horizon (days)"
            name="hist_horizon"
            extra={
              expandedInfo === "signals"
                ? "Choose which horizon fills the return distribution."
                : undefined
            }
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

    </>
  );
};

export default SidebarForm;
