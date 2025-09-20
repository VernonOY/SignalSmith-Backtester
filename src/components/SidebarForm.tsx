import { useEffect, useMemo, useState } from "react";
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
import dayjs from "dayjs";
import { api } from "../api/client";
import { BacktestRequest, Filters, RSIRule, UniverseMeta } from "../types";

const { RangePicker } = DatePicker;
const { Paragraph, Text } = Typography;

export interface FormValues {
  strategy: string;
  start: string;
  end: string;
  indicators: Record<string, any>;
  rsi_rule?: RSIRule;
  filters?: Filters;
  capital?: number;
  fee_bps?: number;
}

const DEFAULT_PRESET_KEY = "backtest-sidebar-preset";

interface SidebarFormProps {
  loading: boolean;
  onSubmit: (values: FormValues) => Promise<void> | void;
}

const SidebarForm = ({ loading, onSubmit }: SidebarFormProps) => {
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<UniverseMeta>({ sectors: [], mcap_buckets: [] });

  type IndicatorKey = "rsi" | "macd" | "obv" | "ema" | "signals";
  const [showInfo, setShowInfo] = useState<Record<IndicatorKey, boolean>>({
    rsi: false,
    macd: false,
    obv: false,
    ema: false,
    signals: false,
  });

  const toggleInfo = (key: IndicatorKey) => {
    setShowInfo((prev) => ({ ...prev, [key]: !prev[key] }));
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

  const handleReset = () => {
    form.resetFields();
  };

  const handleSavePreset = () => {
    const values = form.getFieldsValue();
    localStorage.setItem(DEFAULT_PRESET_KEY, JSON.stringify(values));
    message.success("Preset saved locally");
  };

  const submit = async (values: any) => {
    const [start, end] = values.date;
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

    const request: FormValues = {
      strategy: values.strategy,
      start: start.format("YYYY-MM-DD"),
      end: end.format("YYYY-MM-DD"),
      indicators: {
        policy: values.policy,
        atleast_k: values.k,
        max_horizon: values.max_horizon,
        hist_horizon: values.hist_horizon,
        rsi: {
          use: true,
          n: values.rsi_n,
          rule: values.rsi_rule.mode,
          oversold: values.rsi_rule.mode === "oversold" ? values.rsi_rule.threshold : undefined,
          overbought: values.rsi_rule.mode === "overbought" ? values.rsi_rule.threshold : undefined,
        },
        macd: values.use_macd
          ? {
              use: true,
              fast: values.macd_fast,
              slow: values.macd_slow,
              signal: values.macd_signal,
              rule: values.macd_rule,
            }
          : { use: false },
        obv: values.use_obv
          ? {
              use: true,
              rule: values.obv_rule,
            }
          : { use: false },
        ema: values.use_ema
          ? {
              use: true,
              short: values.ema_short,
              long: values.ema_long,
            }
          : { use: false },
      },
      rsi_rule: values.rsi_rule,
      filters: hasFilters ? filters : undefined,
      capital: values.capital,
      fee_bps: values.fee_bps,
    };
    await onSubmit(request);
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={submit}
      initialValues={{
        strategy: "mean_reversion",
        date: [dayjs().subtract(1, "year"), dayjs()],
        rsi_rule: { mode: "oversold", threshold: 30 },
        rsi_n: 14,
        policy: "any",
        k: 2,
        max_horizon: 10,
        hist_horizon: 1,
        use_macd: false,
        macd_fast: 12,
        macd_slow: 26,
        macd_signal: 9,
        macd_rule: "signal",
        use_obv: false,
        obv_rule: "rise",
        use_ema: false,
        ema_short: 12,
        ema_long: 26,
        capital: 100000,
        fee_bps: 1,
        filters: {},
      }}
      style={{ padding: "0 16px", height: "100%", overflowY: "auto" }}
    >
      <Card title="Strategy" size="small" bordered={false} style={{ marginBottom: 16 }}>
        <Form.Item name="strategy" label="Strategy" rules={[{ required: true }]}>
          <Select
            options={[
              { label: "Mean Reversion", value: "mean_reversion" },
              { label: "Momentum", value: "momentum" },
              { label: "Multifactor", value: "multifactor" },
            ]}
          />
        </Form.Item>
        <Form.Item name="date" label="Backtest Range" rules={[{ required: true }]}>
          <RangePicker allowClear={false} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Initial Capital" name="capital">
          <InputNumber min={0} style={{ width: "100%" }} prefix="$" />
        </Form.Item>
        <Form.Item label="Fee (bps)" name="fee_bps">
          <InputNumber min={0} max={100} style={{ width: "100%" }} />
        </Form.Item>
      </Card>

      <Card title="Indicators" size="small" bordered={false} style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={24} style={{ width: "100%" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text strong>Relative Strength Index (RSI)</Text>
              <Button type="link" size="small" onClick={() => toggleInfo("rsi")}>
                {showInfo.rsi ? "Hide" : "Describe"}
              </Button>
            </div>
            {showInfo.rsi && (
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                RSI compares average gains and losses over the lookback window to oscillate between 0 and 100. The
                lookback input sets how many sessions feed the oscillator, the mode chooses whether you trade oversold
                bounces or overbought reversals, and the threshold slider marks the trigger level for that mode.
              </Paragraph>
            )}
            <Form.Item label="RSI Lookback" name="rsi_n" style={{ marginBottom: 12 }}>
              <InputNumber min={2} max={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="RSI Mode" name={["rsi_rule", "mode"]} style={{ marginBottom: 12 }}>
              <Select
                options={[
                  { label: "Oversold (<= threshold)", value: "oversold" },
                  { label: "Overbought (>= threshold)", value: "overbought" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="RSI Threshold (0-100)"
              name={["rsi_rule", "threshold"]}
              extra="Slider adjusts the cut-off used with the selected mode: low values buy oversold dips, high values fade overbought rallies."
            >
              <Slider min={0} max={100} step={1} />
            </Form.Item>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text strong>Moving Average Convergence Divergence (MACD)</Text>
              <Button type="link" size="small" onClick={() => toggleInfo("macd")}>
                {showInfo.macd ? "Hide" : "Describe"}
              </Button>
            </div>
            {showInfo.macd && (
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                MACD tracks the spread between fast and slow exponential moving averages. The fast and slow spans define
                those EMAs, the signal span smooths the MACD line, and the rule selector decides whether signals come
                from a signal-line crossover or simply a positive MACD reading.
              </Paragraph>
            )}
            <Form.Item label="Enable MACD" name="use_macd" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Switch />
            </Form.Item>
            <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
              <Form.Item label="Fast" name="macd_fast" style={{ flex: 1, marginBottom: 0 }}>
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="Slow" name="macd_slow" style={{ flex: 1, marginBottom: 0 }}>
                <InputNumber min={1} max={40} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="Signal" name="macd_signal" style={{ flex: 1, marginBottom: 0 }}>
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Space>
            <Form.Item label="MACD Rule" name="macd_rule">
              <Select
                options={[
                  { label: "Signal Crossover", value: "signal" },
                  { label: "MACD > 0", value: "positive" },
                ]}
              />
            </Form.Item>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text strong>On-Balance Volume (OBV)</Text>
              <Button type="link" size="small" onClick={() => toggleInfo("obv")}>
                {showInfo.obv ? "Hide" : "Describe"}
              </Button>
            </div>
            {showInfo.obv && (
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                OBV cumulates volume by adding it on up days and subtracting it on down days to confirm price trends.
                Use the toggle to include OBV and select whether signals come from the OBV line crossing above its own
                moving average or simply turning positive.
              </Paragraph>
            )}
            <Form.Item label="Enable OBV" name="use_obv" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Switch />
            </Form.Item>
            <Form.Item label="OBV Rule" name="obv_rule">
              <Select
                options={[
                  { label: "OBV crosses above its moving average", value: "rise" },
                  { label: "OBV turns positive", value: "positive" },
                ]}
              />
            </Form.Item>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text strong>Exponential Moving Average Cross (EMA)</Text>
              <Button type="link" size="small" onClick={() => toggleInfo("ema")}>
                {showInfo.ema ? "Hide" : "Describe"}
              </Button>
            </div>
            {showInfo.ema && (
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                The EMA cross checks when a shorter-term EMA overtakes a longer-term EMA. The short and long inputs
                control the span of each EMA and therefore how reactive the crossover strategy becomes.
              </Paragraph>
            )}
            <Form.Item label="Enable EMA Cross" name="use_ema" valuePropName="checked" style={{ marginBottom: 12 }}>
              <Switch />
            </Form.Item>
            <Space style={{ width: "100%" }} size={12}>
              <Form.Item label="Short" name="ema_short" style={{ flex: 1, marginBottom: 0 }}>
                <InputNumber min={2} max={50} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="Long" name="ema_long" style={{ flex: 1, marginBottom: 0 }}>
                <InputNumber min={5} max={200} style={{ width: "100%" }} />
              </Form.Item>
            </Space>
          </div>
        </Space>
      </Card>

      <Card title="Universe Filters" size="small" bordered={false} style={{ marginBottom: 16 }}>
        <Form.Item label="Sector" name={["filters", "sectors"]}>
          <Select mode="multiple" allowClear options={sectorOptions} />
        </Form.Item>
        <Form.Item label="Market Cap Min ($)" name={["filters", "mcap_min"]}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Market Cap Max ($)" name={["filters", "mcap_max"]}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Exclude Tickers" name={["filters", "exclude_tickers"]}>
          <Select mode="tags" tokenSeparators={[",", " "]} placeholder="e.g. TSLA, NVDA" />
        </Form.Item>
      </Card>

      <Card title="Signals" size="small" bordered={false} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: showInfo.signals ? 8 : 0 }}>
          <Button type="link" size="small" onClick={() => toggleInfo("signals")}>
            {showInfo.signals ? "Hide" : "Describe"}
          </Button>
        </div>
        {showInfo.signals && (
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            Control how individual indicators combine into trade signals. The policy field chooses the aggregation rule,
            the parameter <em>k</em> is used when requiring at least a certain number of signals, and the horizon inputs
            cap how long trades can remain open and how far back to scan for histogram calculations.
          </Paragraph>
        )}
        <Form.Item label="Combination Policy" name="policy">
          <Select
            options={[
              { label: "Any", value: "any" },
              { label: "All", value: "all" },
              { label: "At least k", value: "atleast_k" },
            ]}
          />
        </Form.Item>
        <Form.Item label="k" name="k">
          <InputNumber min={1} max={5} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Max Horizon (days)" name="max_horizon">
          <InputNumber min={1} max={10} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="Histogram Horizon (days)" name="hist_horizon">
          <InputNumber min={1} max={10} style={{ width: "100%" }} />
        </Form.Item>
      </Card>

      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <Button type="primary" htmlType="submit" loading={loading}>
            Run Backtest
          </Button>
          <Button onClick={handleReset}>Reset</Button>
        </Space>
        <Button onClick={handleSavePreset}>Save Preset</Button>
      </Space>
    </Form>
  );
};

export default SidebarForm;
