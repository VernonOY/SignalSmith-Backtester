import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
  message,
} from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api/client";
import { BacktestRequest, Filters, RSIRule, UniverseMeta } from "../types";

const { RangePicker } = DatePicker;
const { Text } = Typography;

const DEFAULT_PRESET_KEY = "backtest-sidebar-preset";
const MIN_DATE = dayjs("2020-01-01");
const LOOKBACK_YEARS = 5;

interface SidebarFormProps {
  loading: boolean;
  onSubmit: (payload: BacktestRequest, rawValues: any) => Promise<void> | void;
  compact?: boolean;
}

const ABBREVIATIONS: { term: string; definition: string }[] = [
  { term: "RSI", definition: "Relative Strength Index" },
  { term: "MACD", definition: "Moving Average Convergence Divergence" },
  { term: "OBV", definition: "On-Balance Volume" },
  { term: "EMA", definition: "Exponential Moving Average" },
  { term: "ADX", definition: "Average Directional Index" },
  { term: "AROON", definition: "Aroon Oscillator" },
  { term: "STOCH", definition: "Stochastic Oscillator" },
  { term: "SL", definition: "Stop-loss percentage" },
  { term: "TP", definition: "Take-profit percentage" },
  { term: "Lkb", definition: "Lookback window (period count)" },
  { term: "Th", definition: "Threshold value" },
  { term: "Sig", definition: "Signal smoothing period" },
  { term: "%K", definition: "%K line period in Stochastic" },
  { term: "%D", definition: "%D signal line period in Stochastic" },
  { term: "OS", definition: "Oversold" },
  { term: "OB", definition: "Overbought" },
  { term: "Hz", definition: "Horizon in trading days" },
  { term: "Bins", definition: "Number of histogram buckets" },
  { term: "Cap", definition: "Market capitalisation" },
  { term: "MA", definition: "Moving Average" },
];

const getEarliestAllowed = () => {
  const today = dayjs();
  const candidate = today.subtract(LOOKBACK_YEARS, "year").startOf("day");
  return candidate.isBefore(MIN_DATE) ? MIN_DATE : candidate;
};

const DEFAULT_STRATEGY_VALUES: Record<string, unknown> = {
  enable_rsi: true,
  use_macd: false,
  use_obv: false,
  use_ema: true,
  use_adx: false,
  use_aroon: false,
  use_stoch: false,
  rsi_rule: { mode: "oversold", threshold: 30 },
};

const SidebarForm = ({ loading, onSubmit, compact = false }: SidebarFormProps) => {
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<UniverseMeta>({ sectors: [], mcap_buckets: [] });
  const [showUniverseFilters, setShowUniverseFilters] = useState(true);
  const [showSignalRules, setShowSignalRules] = useState(true);
  const [describeOpen, setDescribeOpen] = useState(false);
  const storage = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    try {
      const candidate = window.localStorage;
      const testKey = "__signalsmith_persist_test__";
      candidate.setItem(testKey, "1");
      candidate.removeItem(testKey);
      return candidate;
    } catch (error) {
      console.warn("Local storage unavailable; presets disabled.", error);
      return null;
    }
  }, []);

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
    if (!storage) {
      return;
    }
    try {
      const preset = storage.getItem(DEFAULT_PRESET_KEY);
      if (preset) {
        const parsed = JSON.parse(preset);
        form.setFieldsValue(parsed);
      }
    } catch (error) {
      console.warn("Invalid preset in storage", error);
    }
  }, [form, storage]);

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
    setShowUniverseFilters(true);
    setShowSignalRules(true);
  };

  const openDescribe = useCallback(() => setDescribeOpen(true), []);
  const closeDescribe = useCallback(() => setDescribeOpen(false), []);

  const renderDescribeButton = useCallback(
    () => (
      <Button type="link" size="small" className="sidebar-card__action" onClick={openDescribe}>
        Describe
      </Button>
    ),
    [openDescribe]
  );

  const handleSavePreset = () => {
    if (!storage) {
      message.warning("Unable to access browser storage; preset not saved.");
      return;
    }
    try {
      const values = form.getFieldsValue();
      storage.setItem(DEFAULT_PRESET_KEY, JSON.stringify(values));
      message.success("Preset saved locally");
    } catch (error) {
      console.warn("Failed to persist preset", error);
      message.error("Unable to save preset");
    }
  };

  const enableRsi = Form.useWatch("enable_rsi", form) ?? true;
  const useMacd = Form.useWatch("use_macd", form) ?? false;
  const useObv = Form.useWatch("use_obv", form) ?? false;
  const useEma = Form.useWatch("use_ema", form) ?? false;
  const useAdx = Form.useWatch("use_adx", form) ?? false;
  const useAroon = Form.useWatch("use_aroon", form) ?? false;
  const useStoch = Form.useWatch("use_stoch", form) ?? false;
  const policyValue = Form.useWatch("policy", form) ?? "all";

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

    const binWidthInput = values.hist_bin_width_pct;
    const binWidth =
      typeof binWidthInput === "number" && !Number.isNaN(binWidthInput)
        ? binWidthInput / 100
        : undefined;

    const indicatorsPayload: Record<string, any> = {
      policy: values.policy,
      atleast_k: values.k,
      max_horizon: values.max_horizon,
      stop_loss_pct: stopLoss,
      take_profit_pct: takeProfit,
    };

    if (typeof binWidth === "number") {
      indicatorsPayload.bin_width = binWidth;
    }

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

    const strategyValue = values.strategy ?? "mean_reversion";

    const payload: BacktestRequest = {
      strategy: strategyValue,
      start: start.format("YYYY-MM-DD"),
      end: end.format("YYYY-MM-DD"),
      indicators: indicatorsPayload,
      rsi_rule: enableRsi ? (values.rsi_rule as RSIRule) : undefined,
      filters: hasFilters ? filters : undefined,
      capital: values.capital,
      fee_bps: values.fee_bps,
      stop_loss_pct: stopLoss,
      take_profit_pct: takeProfit,
      hist_bin_width: binWidth,
    };

    await onSubmit(payload, values);
  };

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        size="small"
        className={`sidebar-form${compact ? " sidebar-form--compact" : ""}`}
        onFinish={submit}
        initialValues={{
          strategy: "mean_reversion",
          ...DEFAULT_STRATEGY_VALUES,
          date: [defaultStart, today],
          capital: 100000,
          fee_bps: 1,
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
          policy: "all",
          k: 2,
          max_horizon: 10,
          hist_bin_width_pct: 1,
          filters: {},
        }}
      >
        <Card
          title="Run Settings"
          size="small"
          bordered={false}
          className="sidebar-card sidebar-card--compact sidebar-card--full"
          extra={renderDescribeButton()}
        >
          <Form.Item name="strategy" hidden initialValue="mean_reversion">
            <Input />
          </Form.Item>
          <div className="form-grid form-grid--two">
            <Form.Item
              name="date"
              label="Range"
              rules={[{ required: true }]}
              className="form-grid__item form-grid__item--range"
            >
              <RangePicker allowClear={false} style={{ width: "100%" }} disabledDate={disabledDate} />
            </Form.Item>
            <Form.Item
              label="Capital"
              name="capital"
              className="form-grid__item form-grid__item--capital"
            >
              <InputNumber min={0} style={{ width: "100%" }} addonBefore="$" />
            </Form.Item>
          </div>
          <div className="form-grid form-grid--four">
            <Form.Item label="Fee" name="fee_bps" className="form-grid__item">
              <InputNumber min={0} max={100} style={{ width: "100%" }} addonAfter="bp" />
            </Form.Item>
            <Form.Item label="SL" name="stop_loss_pct" className="form-grid__item">
              <InputNumber min={0} max={100} style={{ width: "100%" }} addonAfter="%" placeholder="—" />
            </Form.Item>
            <Form.Item label="TP" name="take_profit_pct" className="form-grid__item">
              <InputNumber min={0} max={200} style={{ width: "100%" }} addonAfter="%" placeholder="—" />
            </Form.Item>
          </div>
        </Card>

        <Card
          title="Indicators"
          size="small"
          bordered={false}
          className="sidebar-card sidebar-card--indicators sidebar-card--full"
          extra={renderDescribeButton()}
        >
          <div className="indicator-grid">
            <div className="indicator-grid__item">
              <div className="indicator-header">
                <Tooltip title="Relative Strength Index">
                  <Text strong>RSI</Text>
                </Tooltip>
                <Space size={6} align="center" className="indicator-header__actions">
                  <Form.Item name="enable_rsi" valuePropName="checked" noStyle>
                    <Switch size="small" aria-label="Toggle RSI" />
                  </Form.Item>
                </Space>
              </div>
              <div className="indicator-fields">
                <Form.Item
                  label="Mode"
                  name={["rsi_rule", "mode"]}
                  className="indicator-field indicator-field--full"
                >
                  <Select
                    options={[
                      { label: "Oversold", value: "oversold" },
                      { label: "Overbought", value: "overbought" },
                    ]}
                    dropdownMatchSelectWidth={false}
                    disabled={!enableRsi}
                  />
                </Form.Item>
                <Form.Item label="Lkb" name="rsi_n" className="indicator-field">
                  <InputNumber min={2} max={100} style={{ width: "100%" }} disabled={!enableRsi} />
                </Form.Item>
                <Form.Item label="Th" name={["rsi_rule", "threshold"]} className="indicator-field">
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!enableRsi} />
                </Form.Item>
              </div>
            </div>

            <div className="indicator-grid__item">
              <div className="indicator-header">
                <Tooltip title="Moving Average Convergence Divergence">
                  <Text strong>MACD</Text>
                </Tooltip>
                <Space size={6} align="center" className="indicator-header__actions">
                  <Form.Item name="use_macd" valuePropName="checked" noStyle>
                    <Switch size="small" aria-label="Toggle MACD" />
                  </Form.Item>
                </Space>
              </div>
              <div className="indicator-fields">
                <Form.Item label="Rule" name="macd_rule" className="indicator-field">
                  <Select
                    options={[
                      { label: "Signal", value: "signal" },
                      { label: "> 0", value: "positive" },
                    ]}
                    dropdownMatchSelectWidth={false}
                    disabled={!useMacd}
                  />
                </Form.Item>
                <Form.Item label="Fast" name="macd_fast" className="indicator-field">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item label="Slow" name="macd_slow" className="indicator-field">
                  <InputNumber min={1} max={40} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item label="Sig" name="macd_signal" className="indicator-field">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
              </div>
            </div>

            <div className="indicator-grid__item">
              <div className="indicator-header">
                <Tooltip title="On-Balance Volume">
                  <Text strong>OBV</Text>
                </Tooltip>
                <Space size={6} align="center" className="indicator-header__actions">
                  <Form.Item name="use_obv" valuePropName="checked" noStyle>
                    <Switch size="small" aria-label="Toggle OBV" />
                  </Form.Item>
                </Space>
              </div>
              <div className="indicator-fields">
                <Form.Item
                  label="Rule"
                  name="obv_rule"
                  className="indicator-field indicator-field--full"
                >
                  <Select
                    options={[
                      { label: "MA Rise", value: "rise" },
                      { label: "> 0", value: "positive" },
                    ]}
                    dropdownMatchSelectWidth={false}
                    disabled={!useObv}
                  />
                </Form.Item>
              </div>
            </div>

            <div className="indicator-grid__item">
              <div className="indicator-header">
                <Tooltip title="Aroon Oscillator">
                  <Text strong>AROON</Text>
                </Tooltip>
                <Space size={6} align="center" className="indicator-header__actions">
                  <Form.Item name="use_aroon" valuePropName="checked" noStyle>
                    <Switch size="small" aria-label="Toggle Aroon" />
                  </Form.Item>
                </Space>
              </div>
              <div className="indicator-fields">
                <Form.Item label="Lkb" name="aroon_n" className="indicator-field">
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item label="Up" name="aroon_up" className="indicator-field">
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item label="Dn" name="aroon_down" className="indicator-field">
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
              </div>
            </div>

            <div className="indicator-grid__item">
              <div className="indicator-stack">
                <div className="indicator-stack__section">
                  <div className="indicator-header indicator-header--stacked">
                    <Tooltip title="EMA crossover">
                      <Text strong>EMA</Text>
                    </Tooltip>
                    <Space size={6} align="center" className="indicator-header__actions">
                      <Form.Item name="use_ema" valuePropName="checked" noStyle>
                        <Switch size="small" aria-label="Toggle EMA" />
                      </Form.Item>
                    </Space>
                  </div>
                  <div className="indicator-fields indicator-fields--compact">
                    <Form.Item label="Short" name="ema_short" className="indicator-field">
                      <InputNumber min={2} max={50} style={{ width: "100%" }} disabled={!useEma} />
                    </Form.Item>
                    <Form.Item label="Long" name="ema_long" className="indicator-field">
                      <InputNumber min={5} max={200} style={{ width: "100%" }} disabled={!useEma} />
                    </Form.Item>
                  </div>
                </div>
                <div className="indicator-stack__divider" aria-hidden />
                <div className="indicator-stack__section">
                  <div className="indicator-header indicator-header--stacked">
                    <Tooltip title="Average Directional Index">
                      <Text strong>ADX</Text>
                    </Tooltip>
                    <Space size={6} align="center" className="indicator-header__actions">
                      <Form.Item name="use_adx" valuePropName="checked" noStyle>
                        <Switch size="small" aria-label="Toggle ADX" />
                      </Form.Item>
                    </Space>
                  </div>
                  <div className="indicator-fields indicator-fields--compact">
                    <Form.Item label="Lkb" name="adx_n" className="indicator-field">
                      <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAdx} />
                    </Form.Item>
                    <Form.Item label="Min" name="adx_min" className="indicator-field">
                      <InputNumber min={5} max={60} style={{ width: "100%" }} disabled={!useAdx} />
                    </Form.Item>
                  </div>
                </div>
              </div>
            </div>

            <div className="indicator-grid__item">
              <div className="indicator-header">
                <Tooltip title="Stochastic Oscillator">
                  <Text strong>STOCH</Text>
                </Tooltip>
                <Space size={6} align="center" className="indicator-header__actions">
                  <Form.Item name="use_stoch" valuePropName="checked" noStyle>
                    <Switch size="small" aria-label="Toggle Stochastic" />
                  </Form.Item>
                </Space>
              </div>
              <div className="indicator-fields indicator-fields--triple">
                <Form.Item label="Rule" name="stoch_rule" className="indicator-field indicator-field--full">
                  <Select
                    options={[
                      { label: "Signal", value: "signal" },
                      { label: "OS", value: "oversold" },
                      { label: "OB", value: "overbought" },
                    ]}
                    dropdownMatchSelectWidth={false}
                    disabled={!useStoch}
                  />
                </Form.Item>
                <Form.Item label="%K" name="stoch_k" className="indicator-field">
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item label="%D" name="stoch_d" className="indicator-field">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item
                  label="Th"
                  name="stoch_threshold"
                  className="indicator-field indicator-field--full"
                >
                  <InputNumber min={1} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Universe Filters"
          size="small"
          bordered={false}
          className="sidebar-card sidebar-card--half"
          extra={
            <Button
              type="link"
              size="small"
              className="sidebar-card__action"
              onClick={() => setShowUniverseFilters((prev) => !prev)}
            >
              {showUniverseFilters ? "Hide" : "Show"}
            </Button>
          }
        >
          {showUniverseFilters && (
            <div className="form-grid form-grid--universe">
              <Form.Item label="Sector" name={["filters", "sectors"]} className="form-grid__item">
                <Select mode="multiple" allowClear options={sectorOptions} dropdownMatchSelectWidth={false} />
              </Form.Item>
              <Form.Item label="Cap Min" name={["filters", "mcap_min"]} className="form-grid__item">
                <InputNumber min={0} style={{ width: "100%" }} addonBefore="$" />
              </Form.Item>
              <Form.Item label="Cap Max" name={["filters", "mcap_max"]} className="form-grid__item">
                <InputNumber min={0} style={{ width: "100%" }} addonBefore="$" />
              </Form.Item>
              <Form.Item label="Exclude" name={["filters", "exclude_tickers"]} className="form-grid__item">
                <Select mode="tags" tokenSeparators={[",", " "]} placeholder="TSLA, NVDA" dropdownMatchSelectWidth={false} />
              </Form.Item>
            </div>
          )}
        </Card>

        <Card
          title="Signal Rules"
          size="small"
          bordered={false}
          className="sidebar-card sidebar-card--half"
          extra={
            <Button
              type="link"
              size="small"
              className="sidebar-card__action"
              onClick={() => setShowSignalRules((prev) => !prev)}
            >
              {showSignalRules ? "Hide" : "Show"}
            </Button>
          }
        >
          {showSignalRules && (
            <div className="form-grid form-grid--signals">
              <Form.Item
                label="Policy"
                name="policy"
                className="form-grid__item form-grid__item--span-2"
              >
                <Select
                  options={[
                    { label: "Any", value: "any" },
                    { label: "All", value: "all" },
                    { label: "At least k", value: "atleast_k" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="k" name="k" className="form-grid__item">
                <InputNumber min={1} max={7} style={{ width: "100%" }} disabled={policyValue !== "atleast_k"} />
              </Form.Item>
              <Form.Item label="Max Hz" name="max_horizon" className="form-grid__item">
                <InputNumber min={1} max={10} style={{ width: "100%" }} addonAfter="d" />
              </Form.Item>
              <Form.Item label="Bin Width" name="hist_bin_width_pct" className="form-grid__item">
                <InputNumber
                  min={0.1}
                  max={20}
                  step={0.1}
                  style={{ width: "100%" }}
                  addonAfter="%"
                />
              </Form.Item>
            </div>
          )}
        </Card>

        <Space className="sidebar-form__actions">
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              Run Backtest
            </Button>
            <Button onClick={handleReset}>Reset</Button>
          </Space>
          <Space>
            <Button onClick={handleSavePreset}>Save Preset</Button>
        </Space>
      </Space>
    </Form>

    <Modal title="Glossary of abbreviations" open={describeOpen} onCancel={closeDescribe} footer={null} centered>
      <div className="describe-modal__list">
        {ABBREVIATIONS.map((item) => (
          <div key={item.term} className="describe-modal__item">
            <span className="describe-modal__term">{item.term}</span>
            <span className="describe-modal__definition">{item.definition}</span>
          </div>
        ))}
      </div>
    </Modal>

  </>
);
};

export default SidebarForm;
