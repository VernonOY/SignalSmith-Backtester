import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, ConfigProvider, Select, Typography, message, theme } from "antd";
import html2canvas from "html2canvas";
import SidebarForm from "./components/SidebarForm";
import { BacktestRequest, BacktestResponse } from "./types";
import { api } from "./api/client";
import HistogramChart from "./components/HistogramChart";
import IndicatorStatsTable from "./components/IndicatorStatsTable";
import EquityChart from "./components/EquityChart";
import { formatCurrency, formatNumber, formatPercent } from "./utils/format";

const { Title, Text } = Typography;

interface InfoTag {
  label: string;
  value: string;
}

interface EquityMetricDisplay {
  key: string;
  label: string;
  value: string;
}

const App = () => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<BacktestResponse | null>(null);
  const [lastRunConfig, setLastRunConfig] = useState<BacktestRequest | null>(null);
  const [selectedHorizon, setSelectedHorizon] = useState<number | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (payload: BacktestRequest, _rawValues?: any) => {
    try {
      setLoading(true);
      const { data } = await api.post<BacktestResponse>("/run_backtest", payload);
      setResponse(data);
      setLastRunConfig(payload);
      message.success("Backtest complete");
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error.message;
      message.error(detail ?? "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExportScreenshot = useCallback(async () => {
    const container = dashboardRef.current;
    if (!container) return;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const canvas = await html2canvas(
      container,
      {
        background: "#eef1ff",
        scale: window.devicePixelRatio,
      } as any
    );
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "signalsmith-dashboard.png";
    link.click();
  }, []);

  const optionalCurrency = useCallback(
    (value?: number | null) => (typeof value === "number" ? formatCurrency(value, 0) : "—"),
    []
  );
  const optionalPercent = useCallback(
    (value?: number | null, digits = 1) =>
      typeof value === "number" ? formatPercent(value, digits) : "—",
    []
  );

  const horizonResults = response?.horizon_results ?? null;

  const availableHorizons = useMemo(() => {
    if (!horizonResults) {
      return [] as number[];
    }
    return Object.keys(horizonResults)
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
  }, [horizonResults]);

  useEffect(() => {
    if (!response) {
      setSelectedHorizon(null);
      return;
    }
    if (!availableHorizons.length) {
      setSelectedHorizon(null);
      return;
    }
    const preferred = response.hold_days;
    if (preferred && availableHorizons.includes(preferred)) {
      setSelectedHorizon(preferred);
      return;
    }
    setSelectedHorizon((current) => {
      if (current && availableHorizons.includes(current)) {
        return current;
      }
      return availableHorizons[0] ?? null;
    });
  }, [response, availableHorizons]);

  const activeHorizon = useMemo(() => {
    if (!availableHorizons.length) {
      return null;
    }
    if (selectedHorizon && availableHorizons.includes(selectedHorizon)) {
      return selectedHorizon;
    }
    if (response?.hold_days && availableHorizons.includes(response.hold_days)) {
      return response.hold_days;
    }
    return availableHorizons[0] ?? null;
  }, [availableHorizons, selectedHorizon, response?.hold_days]);

  const activeHorizonResult = useMemo(() => {
    if (!horizonResults || activeHorizon == null) {
      return null;
    }
    const key = String(activeHorizon);
    return horizonResults[key] ?? null;
  }, [horizonResults, activeHorizon]);

  const equitySeries = activeHorizonResult?.equity_curve ?? response?.equity_curve;

  const horizonOptions = useMemo(
    () => availableHorizons.map((value) => ({ label: `${value}d`, value })),
    [availableHorizons]
  );

  const equityMetricConfigs = useMemo(
    () => [
      {
        key: "avg_daily_return",
        label: "Avg Daily Return",
        format: (value?: number | null) => optionalPercent(value, 2),
      },
      {
        key: "volatility_daily",
        label: "Daily Volatility",
        format: (value?: number | null) => optionalPercent(value, 2),
      },
      {
        key: "annualized_return",
        label: "Annualized Return",
        format: (value?: number | null) => optionalPercent(value, 2),
      },
      {
        key: "annualized_vol",
        label: "Annualized Volatility",
        format: (value?: number | null) => optionalPercent(value, 2),
      },
      {
        key: "sharpe",
        label: "Sharpe Ratio",
        format: (value?: number | null) =>
          typeof value === "number" ? value.toFixed(2) : "—",
      },
      {
        key: "max_drawdown",
        label: "Max Drawdown",
        format: (value?: number | null) => optionalPercent(value, 2),
      },
    ],
    [optionalPercent]
  );

  const equityMetrics = useMemo(() => {
    const metricSource = activeHorizonResult?.metrics ?? response?.metrics;
    if (!metricSource) return [] as EquityMetricDisplay[];
    return equityMetricConfigs.reduce<EquityMetricDisplay[]>((acc, config) => {
      const rawValue = metricSource?.[config.key];
      if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
        return acc;
      }
      acc.push({ key: config.key, label: config.label, value: config.format(rawValue) });
      return acc;
    }, []);
  }, [equityMetricConfigs, activeHorizonResult, response?.metrics]);

  const settingsSummary = useMemo(() => {
    if (!lastRunConfig) return [] as InfoTag[];
    const entries: InfoTag[] = [];
    const indicators = (lastRunConfig.indicators ?? {}) as Record<string, any>;
    const filters = lastRunConfig.filters ?? {};
    entries.push({ label: "Range", value: `${lastRunConfig.start} → ${lastRunConfig.end}` });
    entries.push({ label: "Capital", value: optionalCurrency(lastRunConfig.capital) });
    entries.push({
      label: "Fee",
      value:
        typeof lastRunConfig.fee_bps === "number"
          ? `${formatNumber(lastRunConfig.fee_bps, 1)} bp`
          : "—",
    });
    entries.push({
      label: "Hold",
      value: response ? `${formatNumber(response.hold_days, 0)} d` : "—",
    });
    entries.push({
      label: "Max Hz",
      value:
        typeof indicators.max_horizon === "number"
          ? `${formatNumber(indicators.max_horizon, 0)} d`
          : "—",
    });
    entries.push({ label: "Stop", value: optionalPercent(lastRunConfig.stop_loss_pct) });
    entries.push({ label: "Take", value: optionalPercent(lastRunConfig.take_profit_pct) });
    const sectors = Array.isArray(filters.sectors) && filters.sectors.length
      ? filters.sectors.join(" · ")
      : "—";
    entries.push({ label: "Sectors", value: sectors });
    const policyValue = indicators.policy ? String(indicators.policy).toLowerCase() : "—";
    entries.push({ label: "Policy", value: policyValue });
    entries.push({
      label: "At Least",
      value:
        typeof indicators.atleast_k === "number"
          ? formatNumber(indicators.atleast_k, 0)
          : "—",
    });
    const binWidth =
      typeof indicators.bin_width === "number"
        ? indicators.bin_width
        : typeof lastRunConfig.hist_bin_width === "number"
        ? lastRunConfig.hist_bin_width
        : undefined;
    entries.push({
      label: "Bin Width",
      value: typeof binWidth === "number" ? formatPercent(binWidth, 1) : "—",
    });

    const rsiConfig = indicators.rsi;
    let rsiValue = "—";
    if (rsiConfig && rsiConfig.use !== false) {
      const rsiPieces = [`n=${formatNumber(rsiConfig.n, 0)}`];
      if (rsiConfig.rule === "oversold" && typeof rsiConfig.oversold === "number") {
        rsiPieces.push(`OS≤${formatNumber(rsiConfig.oversold, 0)}`);
      }
      if (rsiConfig.rule === "overbought" && typeof rsiConfig.overbought === "number") {
        rsiPieces.push(`OB≥${formatNumber(rsiConfig.overbought, 0)}`);
      }
      rsiValue = rsiPieces.join(" · ");
    }
    entries.push({ label: "RSI", value: rsiValue });

    const macdConfig = indicators.macd;
    let macdValue = "—";
    if (
      macdConfig &&
      macdConfig.use !== false &&
      typeof macdConfig.fast === "number" &&
      typeof macdConfig.slow === "number" &&
      typeof macdConfig.signal === "number"
    ) {
      const rule = macdConfig.rule ? String(macdConfig.rule).toUpperCase() : "—";
      macdValue = `${formatNumber(macdConfig.fast, 0)}/${formatNumber(macdConfig.slow, 0)}/${formatNumber(macdConfig.signal, 0)} · ${rule}`;
    }
    entries.push({ label: "MACD", value: macdValue });

    return entries;
  }, [lastRunConfig, optionalCurrency, optionalPercent, response]);

  const hasIndicatorStats = Boolean(response?.indicator_statistics);
  const hasSettingsSummary = settingsSummary.length > 0;

  const hasIndicatorStats = Boolean(response?.indicator_statistics);
  const hasRunSettings = runSettingsSummary.length > 0;
  const hasUniverseDetails = Boolean(lastRunConfig) && universeSummary.length > 0;
  const hasSignalDetails = Boolean(lastRunConfig) && signalSummary.length > 0;
  const showDetailsCard =
    hasIndicatorStats || hasRunSettings || hasUniverseDetails || hasSignalDetails;

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.compactAlgorithm,
        token: {
          borderRadius: 16,
          fontSize: 28,
          fontSizeHeading3: 40,
          fontSizeHeading4: 32,
        },
      }}
    >
      <div className="dashboard" ref={dashboardRef}>
        <header className="dashboard__header">
          <div className="dashboard__heading">
            <Title level={3}>SignalSmith Backtester</Title>
          </div>
          <div className="dashboard__actions">
            <Button size="large" type="primary" onClick={handleExportScreenshot}>
              Export Screenshot
            </Button>
          </div>
        </header>
        <div className="dashboard__layout">
          <section className="dashboard__column dashboard__column--inputs">
            <div className="dashboard__panel dashboard__panel--form">
              <SidebarForm loading={loading} onSubmit={handleSubmit} />
            </div>
          </section>

          <section className="dashboard__column dashboard__column--results">
            {response ? (
              <div className="dashboard__results-grid">
                {response.histogram && (
                  <Card className="result-card histogram-card">
                    <div className="card-header">
                      <Title level={4}>Return Distribution</Title>
                    </div>
                    <HistogramChart
                      data={response.histogram}
                      loading={loading}
                      height="45vh"
                    />
                  </Card>
                )}

                {hasIndicatorStats && (
                  <Card className="result-card indicator-card">
                    <div className="card-header">
                      <Title level={4}>Indicator Statistics</Title>
                    </div>
                    <IndicatorStatsTable stats={response!.indicator_statistics!} />
                  </Card>
                )}

                {hasSettingsSummary && (
                  <Card className="result-card settings-card">
                    <div className="card-header">
                      <Title level={4}>Settings</Title>
                    </div>
                    <div className="settings-list">
                      {settingsSummary.map((item) => (
                        <div className="settings-list__item" key={`settings-${item.label}`}>
                          <span className="settings-list__label">{item.label}</span>
                          <span className="settings-list__value">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <Card className="result-card equity-card">
                  <div className="card-header">
                    <Title level={4}>Equity Curve</Title>
                    {horizonOptions.length > 0 && (
                      <div className="card-header__actions">
                        <span className="card-header__label">Holding period</span>
                        <Select
                          size="large"
                          value={activeHorizon ?? undefined}
                          onChange={(value: number) => setSelectedHorizon(value)}
                          options={horizonOptions}
                          style={{ minWidth: "8rem" }}
                          disabled={loading}
                        />
                      </div>
                    )}
                  </div>
                  <EquityChart data={equitySeries} loading={loading} height="42vh" />
                  {equityMetrics.length > 0 && (
                    <div className="run-summary__grid run-summary__grid--metrics">
                      {equityMetrics.map((metric) => (
                        <div className="run-summary__item" key={metric.key}>
                          <span className="run-summary__label">{metric.label}</span>
                          <span className="run-summary__value">{metric.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <Card className="result-card intro-card">
                <Title level={4}>Configure &amp; Run</Title>
                <Text type="secondary">
                  Adjust parameters on the left and run the engine to populate the dashboard.
                </Text>
              </Card>
            )}
          </section>
        </div>

        <footer className="app-footer">
          <p>By Wendi OUYANG – Chinese University of Hong Kong, Shenzhen</p>
          <p>Contact: vernonouyang@gmail.com</p>
        </footer>
      </div>
    </ConfigProvider>
  );
};

export default App;
