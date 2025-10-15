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
  const [compactMode, setCompactMode] = useState(true);
  const [selectedHorizon, setSelectedHorizon] = useState<number | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dashboard-compact", compactMode ? "1" : "0");
    if (compactMode) {
      root.setAttribute("data-compact", "true");
    } else {
      root.removeAttribute("data-compact");
    }
  }, [compactMode]);

  const fitToSinglePage = useCallback((enable = true) => {
    setCompactMode(enable);
  }, []);

  useEffect(() => {
    (window as any).fitToSinglePage = fitToSinglePage;
    return () => {
      delete (window as any).fitToSinglePage;
    };
  }, [fitToSinglePage]);

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
    const wasCompact = compactMode;
    fitToSinglePage(true);
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
    if (!wasCompact) {
      fitToSinglePage(false);
    }
  }, [compactMode, fitToSinglePage]);

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
    if (!lastRunConfig) {
      return [] as InfoTag[];
    }
    const indicators = lastRunConfig.indicators || {};
    const filters = lastRunConfig.filters || {};
    const policy = indicators.policy ? String(indicators.policy).toLowerCase() : "—";
    const sectors = Array.isArray(filters.sectors) && filters.sectors.length
      ? filters.sectors.join(" · ")
      : "—";

    const formatRsi = () => {
      const rsi = indicators.rsi;
      if (!rsi || rsi.use === false) return "—";
      const pieces = [`n=${formatNumber(rsi.n, 0)}`];
      if (typeof rsi.overbought === "number") {
        pieces.push(`OB≥${formatNumber(rsi.overbought, 0)}`);
      }
      if (typeof rsi.oversold === "number" && (!rsi.overbought || rsi.rule === "oversold")) {
        pieces.push(`OS≤${formatNumber(rsi.oversold, 0)}`);
      }
      return pieces.join(" · ") || "—";
    };

    const formatMacd = () => {
      const macd = indicators.macd;
      if (!macd || macd.use === false) return "—";
      if (
        typeof macd.fast !== "number" ||
        typeof macd.slow !== "number" ||
        typeof macd.signal !== "number"
      ) {
        return "—";
      }
      const rule = macd.rule ? String(macd.rule).toUpperCase() : "SIGNAL";
      return `${formatNumber(macd.fast, 0)}/${formatNumber(macd.slow, 0)}/${formatNumber(macd.signal, 0)} · ${rule}`;
    };

    const holdValue = (() => {
      if (typeof response?.hold_days === "number") {
        return `${formatNumber(response.hold_days, 0)} d`;
      }
      if (typeof lastRunConfig.hold_days === "number") {
        return `${formatNumber(lastRunConfig.hold_days, 0)} d`;
      }
      return "—";
    })();

    const maxHzValue = typeof indicators.max_horizon === "number"
      ? `${formatNumber(indicators.max_horizon, 0)} d`
      : "—";

    const feeValue = typeof lastRunConfig.fee_bps === "number"
      ? `${formatNumber(lastRunConfig.fee_bps, 1)} bp`
      : "—";

    const stopValue = optionalPercent(lastRunConfig.stop_loss_pct);
    const takeValue = optionalPercent(lastRunConfig.take_profit_pct);

    const binWidthValue = typeof indicators.bin_width === "number"
      ? formatPercent(indicators.bin_width, 1)
      : "—";

    const atleastValue = typeof indicators.atleast_k === "number"
      ? formatNumber(indicators.atleast_k, 0)
      : "—";

    return [
      { label: "Range", value: `${lastRunConfig.start} → ${lastRunConfig.end}` },
      { label: "Capital", value: optionalCurrency(lastRunConfig.capital) },
      { label: "Fee", value: feeValue },
      { label: "Hold", value: holdValue },
      { label: "Max Hz", value: maxHzValue },
      { label: "Stop", value: stopValue },
      { label: "Take", value: takeValue },
      { label: "Sectors", value: sectors },
      { label: "Policy", value: policy },
      { label: "At Least", value: atleastValue },
      { label: "Bin Width", value: binWidthValue },
      { label: "RSI", value: formatRsi() },
      { label: "MACD", value: formatMacd() },
    ];
  }, [lastRunConfig, optionalCurrency, optionalPercent, response?.hold_days]);

  const hasIndicatorStats = Boolean(response?.indicator_statistics);
  const showDetailsCard = hasIndicatorStats || settingsSummary.length > 0;

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.compactAlgorithm,
        token: {
          borderRadius: 8,
        },
      }}
    >
      <div className="dashboard" ref={dashboardRef} data-compact={compactMode}>
        <header className="dashboard__header">
          <div className="dashboard__heading">
            <Title level={3}>SignalSmith Backtester</Title>
          </div>
          <div className="dashboard__actions">
            <Button size="small" type="primary" onClick={handleExportScreenshot}>
              Export Screenshot
            </Button>
          </div>
        </header>

        <div className="dashboard__body">
          <aside className="dashboard__sidebar">
            <div className="dashboard__sidebar-inner">
              <SidebarForm
                loading={loading}
                onSubmit={handleSubmit}
                compact={compactMode}
              />
            </div>
          </aside>

          <main className="dashboard__content">
            <div className="dashboard__workspace">
              {response ? (
                <div className="dashboard__charts">
                  {response.histogram && (
                    <Card className="result-card histogram-card" size="small">
                      <div className="card-header">
                        <Title level={4}>Return Distribution</Title>
                      </div>
                      <HistogramChart
                        data={response.histogram}
                        loading={loading}
                        compact
                        height={compactMode ? "48vh" : "56vh"}
                      />
                    </Card>
                  )}

                  {showDetailsCard && (
                    <Card className="result-card details-card" size="small">
                      {hasIndicatorStats && (
                        <>
                          <div className="card-header">
                            <Title level={4}>Indicator Statistics</Title>
                          </div>
                          <IndicatorStatsTable stats={response!.indicator_statistics!} compact />
                        </>
                      )}
                      {settingsSummary.length > 0 && (
                        <section className="settings-panel">
                          <div className="card-header">
                            <Title level={4}>Settings</Title>
                          </div>
                          <div className="settings-panel__list">
                            {settingsSummary.map((item) => (
                              <div className="settings-panel__item" key={`setting-${item.label}`}>
                                <span className="settings-panel__label">{item.label}:</span>
                                <span className="settings-panel__value">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </Card>
                  )}

                  <Card className="result-card equity-card" size="small">
                    <div className="card-header">
                      <Title level={4}>Equity Curve</Title>
                      {horizonOptions.length > 0 && (
                        <div className="card-header__actions">
                          <span className="card-header__label">Holding period</span>
                          <Select
                            size="small"
                            value={activeHorizon ?? undefined}
                            onChange={(value: number) => setSelectedHorizon(value)}
                            options={horizonOptions}
                            style={{ minWidth: "8rem" }}
                            disabled={loading}
                          />
                        </div>
                      )}
                    </div>
                    <EquityChart
                      data={equitySeries}
                      loading={loading}
                      compact
                      height={compactMode ? "40vh" : "46vh"}
                    />
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
                <Card className="result-card intro-card" size="small">
                  <Title level={4}>Configure &amp; Run</Title>
                  <Text type="secondary">
                    Adjust parameters on the left and run the engine to populate the dashboard.
                  </Text>
                </Card>
              )}
            </div>
          </main>
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
