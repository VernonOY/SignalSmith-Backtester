import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
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
      hold_days: values.hold_days,
      stop_loss_pct: stopLoss,
      take_profit_pct: takeProfit,
      hist_bins: values.hist_bins,
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
          hist_bins: 5,
          filters: {},
        }}
      >
        <Card title="Run Settings" size="small" bordered={false} className="sidebar-card sidebar-card--compact">
          <Form.Item name="strategy" hidden initialValue="mean_reversion">
            <Input />
          </Form.Item>
          <div className="form-grid form-grid--capital-range">
            <Form.Item
              label="Capital"
              name="capital"
              className="form-grid__item form-grid__item--capital"
            >
              <InputNumber min={0} style={{ width: "100%" }} addonBefore="$" />
            </Form.Item>
            <Form.Item
              name="date"
              label="Range"
              rules={[{ required: true }]}
              className="form-grid__item form-grid__item--range"
            >
              <RangePicker allowClear={false} style={{ width: "100%" }} disabledDate={disabledDate} />
            </Form.Item>
          </div>
          <div className="form-grid form-grid--four">
            <Form.Item label="Fee" name="fee_bps" className="form-grid__item">
              <InputNumber min={0} max={100} style={{ width: "100%" }} addonAfter="bp" />
            </Form.Item>
            <Form.Item label="Hold" name="hold_days" className="form-grid__item">
              <InputNumber min={1} max={10} style={{ width: "100%" }} addonAfter="d" />
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
          className="sidebar-card sidebar-card--indicators"
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

        <Card title="Universe Filters" size="small" bordered={false} className="sidebar-card">
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
        </Card>

        <Card title="Signal Rules" size="small" bordered={false} className="sidebar-card">
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
              <InputNumber min={1} max={7} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Max Hz" name="max_horizon" className="form-grid__item">
              <InputNumber min={1} max={10} style={{ width: "100%" }} addonAfter="d" />
            </Form.Item>
            <Form.Item label="Hist Hz" name="hist_horizon" className="form-grid__item">
              <InputNumber min={1} max={10} style={{ width: "100%" }} addonAfter="d" />
            </Form.Item>
            <Form.Item label="Bins" name="hist_bins" className="form-grid__item">
              <InputNumber min={5} max={60} style={{ width: "100%" }} />
            </Form.Item>
          </div>
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
            <Button onClick={handleSavePreset}>Save Preset</Button>
          </Space>
        </Space>
      </Form>

    </>
  );
};

export default SidebarForm;
