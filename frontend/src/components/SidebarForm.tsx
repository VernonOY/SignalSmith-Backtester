import { useCallback, useEffect, useMemo, useState } from "react";
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
  Modal,
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

const SidebarForm = ({ loading, onSubmit }: SidebarFormProps) => {
  const [form] = Form.useForm();
  const [meta, setMeta] = useState<UniverseMeta>({ sectors: [], mcap_buckets: [] });
  const [infoModal, setInfoModal] = useState<null | InfoModalKey>(null);

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

  const renderInfoContent = () => {
    switch (infoModal) {
      case "strategy":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> Strategy presets simply pre-fill indicator toggles. “Mean Reversion” focuses on RSI and EMA
              crossovers, “Momentum” enables MACD / OBV / Stochastic, and “Multifactor” activates every indicator so you can
              fine-tune thresholds yourself. You may adjust any setting after choosing a preset.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> 策略预设只是快速勾选指标。「均值回归」侧重 RSI 与 EMA，「动量」启用 MACD / OBV / 随机指标，「多因子」一次打开全部指标，方便自行调整阈值。
            </Paragraph>
          </>
        );
      case "execution":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> Hold days determine how long each trade remains open before the platform forces an exit. Stop-loss
              and take-profit inputs apply percentage limits to every trade, while fees (basis points) deduct costs on both entry
              and exit. Adjust these controls to mirror your real-world trading friction.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> 持仓天数规定每笔交易最长持有几天，止损/止盈按百分比限制盈亏，手续费（基点）在买入和卖出时各扣一次。通过这些参数将回测与真实交易成本对齐。
            </Paragraph>
          </>
        );
      case "rsi":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> The Relative Strength Index measures average gains versus losses over the lookback window. Oversold
              mode hunts for rebounds below the threshold, while overbought mode fades rallies above the threshold.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> RSI 通过比较一定周期内的平均涨跌幅度来衡量超买超卖。选择「超卖」时，当 RSI 低于阈值即触发买入；选择「超买」则在 RSI 高于阈值时执行逆向策略。
            </Paragraph>
          </>
        );
      case "macd":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> MACD subtracts a slow EMA from a fast EMA to highlight momentum shifts. The signal-span smooths the
              difference; use the rule control to decide between signal-line crossovers or simply MACD &gt; 0.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> MACD 通过快慢指数均线的差值体现动量变化。信号线负责平滑曲线，可选择「信号交叉」或「MACD 大于零」作为触发条件。
            </Paragraph>
          </>
        );
      case "obv":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> On-Balance Volume cumulates volume on up days and subtracts it on down days. It confirms whether
              price trends are supported by rising participation.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> OBV 在上涨日累加成交量，在下跌日扣除成交量，用于确认趋势是否得到成交量配合。
            </Paragraph>
          </>
        );
      case "ema":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> EMA Cross compares a short-term and long-term exponential moving average. When the short EMA rises
              above the long EMA, it suggests a potential trend change.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> EMA 交叉策略利用短期与长期指数均线的交叉来识别趋势转换，短期均线向上穿越长期均线通常被视为看涨信号。
            </Paragraph>
          </>
        );
      case "adx":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> Average Directional Index quantifies trend strength. Requiring ADX above a minimum value helps you
              avoid flat markets.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> ADX 用于衡量趋势强度，设置最小值可以过滤震荡行情，避免在无趋势的环境中过度交易。
            </Paragraph>
          </>
        );
      case "aroon":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> Aroon Up and Down track how recently highs and lows occurred. Raising the up-threshold emphasises
              fresh highs; lowering the down-threshold highlights fading momentum.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> Aroon 指标通过计算最近的高点或低点出现的时间来衡量趋势力量。提高 Aroon Up 阈值可强调新高，降低 Aroon Down 阈值可突出下行动能的衰退。
            </Paragraph>
          </>
        );
      case "stoch":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> The stochastic oscillator compares the latest close to the range of prices observed during the
              lookback window. Configure %K/%D spans and decide whether to act on signal-line crossovers or extreme zones.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> 随机指标将最新收盘价与设定周期内的价格区间比较，可通过 %K/%D 参数及触发模式设定交叉信号或超买/超卖区间。
            </Paragraph>
          </>
        );
      case "signals":
        return (
          <>
            <Paragraph>
              <strong>English:</strong> Combination policy defines how individual indicators vote together. “Any” fires when one indicator
              is true, “All” requires unanimous agreement, and “At least k” lets you specify the minimum number of agreeing
              indicators. The histogram horizon and hold days must never exceed the maximum horizon input.
            </Paragraph>
            <Paragraph>
              <strong>中文：</strong> 信号组合策略决定多个指标如何共同触发。选择「任意」表示任一指标准备就绪即可交易，「全部」要求全部指标一致，「至少 k 个」可自定义最少同时满足的数量。直方图期限与持仓天数不得超过最大期限。
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
            <Button type="link" size="small" onClick={() => setInfoModal("strategy")}>
              Describe
            </Button>
            <Button type="link" size="small" onClick={() => setInfoModal("execution")}>
              Execution Settings
            </Button>
          </Space>
          <Form.Item
            name="strategy"
            label="Strategy"
            rules={[{ required: true }]}
            extra="English: Choose a preset to pre-fill indicator switches. 中文：选择预设快速启用常用指标，随后仍可手动调整。"
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
            extra="English: Pick dates between 2020-01-01 and today; the span may not exceed five calendar years. 中文：请选择 2020 年以后的日期，最长跨度为最近五年。"
          >
            <RangePicker allowClear={false} style={{ width: "100%" }} disabledDate={disabledDate} />
          </Form.Item>
          <Form.Item
            label="Initial Capital"
            name="capital"
            extra="English: Starting portfolio value in US dollars. 中文：回测初始资金（美元），用于缩放净值曲线。"
          >
            <InputNumber min={0} style={{ width: "100%" }} prefix="$" />
          </Form.Item>
          <Space size={12} style={{ width: "100%" }}>
            <Form.Item
              label="Fee (bps)"
              name="fee_bps"
              style={{ flex: 1 }}
              extra="English: Basis points charged on both entry and exit (10 bps = 0.10%). 中文：买入和卖出都扣除的手续费（基点），10 基点等于 0.10%。"
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label="Hold Days"
              name="hold_days"
              style={{ flex: 1 }}
              extra="English: Maximum number of business days to keep each trade open. 中文：单笔交易最长持有的交易日数量。"
            >
              <InputNumber min={1} max={10} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ width: "100%" }}>
            <Form.Item
              label="Stop Loss (%)"
              name="stop_loss_pct"
              style={{ flex: 1 }}
              extra="English: Optional downside limit per trade (e.g. 5 = -5%). Leave blank for none. 中文：选填的单笔止损百分比，留空表示不设止损。"
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} placeholder="Optional" />
            </Form.Item>
            <Form.Item
              label="Take Profit (%)"
              name="take_profit_pct"
              style={{ flex: 1 }}
              extra="English: Optional upside cap per trade (e.g. 10 = +10%). 中文：选填的单笔止盈百分比，留空表示不设止盈。"
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
                <Button type="link" size="small" onClick={() => setInfoModal("rsi")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable RSI"
                name="enable_rsi"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Toggle the RSI oscillator. 中文：开启或关闭 RSI 指标。"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="RSI Lookback"
                name="rsi_n"
                style={{ marginBottom: 12 }}
                extra="English: Number of days used in the RSI calculation. 中文：RSI 计算所使用的天数。"
              >
                <InputNumber min={2} max={100} style={{ width: "100%" }} disabled={!enableRsi} />
              </Form.Item>
              <Form.Item
                label="RSI Mode"
                name={["rsi_rule", "mode"]}
                style={{ marginBottom: 12 }}
                extra="English: Choose oversold (buy dips) or overbought (fade rallies). 中文：选择在超卖时买入还是在超买时做反转。"
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
                extra="English: Lower values trigger earlier in oversold mode; higher values trigger earlier in overbought mode. 中文：阈值越低越容易在超卖模式触发，越高越容易在超买模式触发。"
              >
                <Slider min={0} max={100} step={1} disabled={!enableRsi} />
              </Form.Item>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Moving Average Convergence Divergence (MACD)</Text>
                <Button type="link" size="small" onClick={() => setInfoModal("macd")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable MACD"
                name="use_macd"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Turn MACD on or off. 中文：开启或关闭 MACD 指标。"
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
                <Form.Item label="Fast" name="macd_fast" style={{ flex: 1, marginBottom: 0 }} extra="短期 EMA 周期" >
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item label="Slow" name="macd_slow" style={{ flex: 1, marginBottom: 0 }} extra="长期 EMA 周期">
                  <InputNumber min={1} max={40} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
                <Form.Item label="Signal" name="macd_signal" style={{ flex: 1, marginBottom: 0 }} extra="信号线周期">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useMacd} />
                </Form.Item>
              </Space>
              <Form.Item
                label="MACD Rule"
                name="macd_rule"
                extra="English: Choose signal-line crossover or MACD > 0. 中文：选择信号线交叉或 MACD 大于零作为触发条件。"
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
                <Button type="link" size="small" onClick={() => setInfoModal("obv")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable OBV"
                name="use_obv"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Turn OBV on or off. 中文：开启或关闭 OBV 指标。"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                label="OBV Rule"
                name="obv_rule"
                extra="English: Decide between OBV crossing its moving average (rise) or turning positive. 中文：选择 OBV 穿越均线或由负转正作为触发条件。"
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
                <Button type="link" size="small" onClick={() => setInfoModal("ema")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable EMA Cross"
                name="use_ema"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Toggle the EMA cross strategy. 中文：开启或关闭 EMA 交叉策略。"
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item label="Short" name="ema_short" style={{ flex: 1, marginBottom: 0 }} extra="English: Short-term EMA span. 中文：短期 EMA 的天数。">
                  <InputNumber min={2} max={50} style={{ width: "100%" }} disabled={!useEma} />
                </Form.Item>
                <Form.Item label="Long" name="ema_long" style={{ flex: 1, marginBottom: 0 }} extra="English: Long-term EMA span. 中文：长期 EMA 的天数。">
                  <InputNumber min={5} max={200} style={{ width: "100%" }} disabled={!useEma} />
                </Form.Item>
              </Space>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Average Directional Index (ADX)</Text>
                <Button type="link" size="small" onClick={() => setInfoModal("adx")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable ADX"
                name="use_adx"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Toggle ADX trend-strength filter. 中文：开启或关闭 ADX 趋势强度过滤。"
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item label="Lookback" name="adx_n" style={{ flex: 1, marginBottom: 0 }} extra="Lookback length">
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAdx} />
                </Form.Item>
                <Form.Item label="Min ADX" name="adx_min" style={{ flex: 1, marginBottom: 0 }} extra="Minimum ADX value">
                  <InputNumber min={5} max={60} style={{ width: "100%" }} disabled={!useAdx} />
                </Form.Item>
              </Space>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Aroon Oscillator</Text>
                <Button type="link" size="small" onClick={() => setInfoModal("aroon")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable Aroon"
                name="use_aroon"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Toggle Aroon indicator. 中文：开启或关闭 Aroon 指标。"
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%" }} size={12}>
                <Form.Item label="Lookback" name="aroon_n" style={{ flex: 1, marginBottom: 0 }} extra="Lookback days">
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item label="Aroon Up" name="aroon_up" style={{ flex: 1, marginBottom: 0 }} extra="Upper threshold">
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
                <Form.Item label="Aroon Down" name="aroon_down" style={{ flex: 1, marginBottom: 0 }} extra="Lower threshold">
                  <InputNumber min={0} max={100} style={{ width: "100%" }} disabled={!useAroon} />
                </Form.Item>
              </Space>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text strong>Stochastic Oscillator</Text>
                <Button type="link" size="small" onClick={() => setInfoModal("stoch")}>
                  Describe
                </Button>
              </div>
              <Form.Item
                label="Enable Stochastic"
                name="use_stoch"
                valuePropName="checked"
                style={{ marginBottom: 12 }}
                extra="English: Toggle Stochastic oscillator. 中文：开启或关闭随机指标。"
              >
                <Switch />
              </Form.Item>
              <Space style={{ width: "100%", marginBottom: 12 }} size={12}>
                <Form.Item label="%K" name="stoch_k" style={{ flex: 1, marginBottom: 0 }} extra="%K lookback">
                  <InputNumber min={5} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item label="%D" name="stoch_d" style={{ flex: 1, marginBottom: 0 }} extra="%D smoothing">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
                <Form.Item label="Threshold" name="stoch_threshold" style={{ flex: 1, marginBottom: 0 }} extra="Threshold for oversold/overbought">
                  <InputNumber min={1} max={50} style={{ width: "100%" }} disabled={!useStoch} />
                </Form.Item>
              </Space>
              <Form.Item
                label="Rule"
                name="stoch_rule"
                extra="English: Decide between signal crossover, oversold, or overbought triggers. 中文：选择交叉信号或超买/超卖触发方式。"
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
          <Form.Item label="Sector" name={["filters", "sectors"]} extra="English: Pick industries to include. 中文：选择需要纳入的行业。">
            <Select mode="multiple" allowClear options={sectorOptions} />
          </Form.Item>
          <Form.Item label="Market Cap Min ($)" name={["filters", "mcap_min"]} extra="English: Smallest allowed market capitalization. 中文：允许的最小市值。">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Market Cap Max ($)" name={["filters", "mcap_max"]} extra="English: Largest allowed market capitalization. 中文：允许的最大市值。">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Exclude Tickers" name={["filters", "exclude_tickers"]} extra="English: Remove specific symbols (comma separated). 中文：排除特定股票代码，使用逗号或空格分隔。">
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder="e.g. TSLA, NVDA" />
          </Form.Item>
        </Card>

        <Card title="Signal Rules" size="small" bordered={false} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <Button type="link" size="small" onClick={() => setInfoModal("signals")}>
              Describe
            </Button>
          </div>
          <Form.Item label="Combination Policy" name="policy" extra="English: Decide how indicator votes combine. 中文：决定多个指标如何共同触发。">
            <Select
              options={[
                { label: "Any", value: "any" },
                { label: "All", value: "all" },
                { label: "At least k", value: "atleast_k" },
              ]}
            />
          </Form.Item>
          <Form.Item label="k" name="k" extra="English: Minimum agreeing indicators when using 'At least k'. 中文：在选择“至少 k 个”时需要满足的指标数量。">
            <InputNumber min={1} max={7} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Max Horizon (days)" name="max_horizon" extra="English: Longest forward-return horizon to compute (also bounds hold days). 中文：计算前瞻收益的最远天数，同时限制持仓天数。">
            <InputNumber min={1} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Histogram Horizon (days)" name="hist_horizon" extra="English: Choose which horizon fills the return distribution. 中文：选择用于绘制收益分布的前瞻天数。">
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
        open={infoModal !== null}
        onCancel={() => setInfoModal(null)}
        footer={null}
        width={720}
        title={(() => {
          switch (infoModal) {
            case "strategy":
              return "Strategy Presets / 策略预设";
            case "execution":
              return "Execution Settings / 执行参数";
            case "rsi":
              return "RSI Guide / RSI 指南";
            case "macd":
              return "MACD Guide / MACD 指南";
            case "obv":
              return "OBV Guide / OBV 指南";
            case "ema":
              return "EMA Cross Guide / EMA 交叉指南";
            case "adx":
              return "ADX Guide / ADX 指南";
            case "aroon":
              return "Aroon Guide / Aroon 指南";
            case "stoch":
              return "Stochastic Guide / 随机指标指南";
            case "signals":
              return "Signal Combination / 信号组合";
            default:
              return "";
          }
        })()}
      >
        {renderInfoContent()}
      </Modal>
    </>
  );
};

export default SidebarForm;
