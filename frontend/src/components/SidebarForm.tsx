import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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

  const renderInfoContent = (key: InfoModalKey): ReactNode => {
    switch (key) {
      case "strategy":
        return (
          <Paragraph>
            Strategy presets simply pre-fill indicator toggles. “Mean Reversion” focuses on RSI and EMA crossovers, “Momentum”
            enables MACD / OBV / Stochastic, and “Multifactor” activates every indicator so you can fine-tune thresholds
            yourself. You may adjust any setting after choosing a preset.
          </Paragraph>
        );
      case "execution":
        return (
          <Paragraph>
            Hold days determine how long each trade remains open before the platform forces an exit. Stop-loss and take-profit
            inputs apply percentage limits to every trade, while fees (basis points) deduct costs on both entry and exit.
            Adjust these controls to mirror your real-world trading friction.
          </Paragraph>
        );
      // Add cases for other info contents like "rsi", "macd", etc.
      default:
        return null;
    }
  };

  return (
    <>
      <Form
        form={form}
        layout="vertical"
        onFinish={onSubmit}
        // Initial values and other content here
      >
        <Card title="Strategy" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <Space style={{ marginBottom: 12 }}>
            <Button type="link" size="small" onClick={() => toggleInfo("strategy")}>
              {expandedInfo === "strategy" ? "Hide Strategy Guide" : "Describe Strategy"}
            </Button>
          </Space>
          {expandedInfo === "strategy" && <div style={infoPanelStyle}>{renderInfoContent("strategy")}</div>}
        </Card>

        {/* Add other sections similarly with expandedInfo logic */}
        
        <Modal
          open={expandedInfo !== null}
          onCancel={() => setExpandedInfo(null)}
          footer={null}
          title={expandedInfo ? INFO_TITLES[expandedInfo] : undefined}
          width={720}
          destroyOnClose
        >
          {expandedInfo ? renderInfoContent(expandedInfo) : null}
        </Modal>
      </Form>
    </>
  );
};

export default SidebarForm;
