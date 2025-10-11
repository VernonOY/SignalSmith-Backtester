import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, ConfigProvider, Typography, message, theme } from "antd";
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
    if (!response?.metrics) return [] as EquityMetricDisplay[];
    return equityMetricConfigs.reduce<EquityMetricDisplay[]>((acc, config) => {
      const rawValue = response.metrics?.[config.key];
      if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
        return acc;
      }
      acc.push({ key: config.key, label: config.label, value: config.format(rawValue) });
      return acc;
    }, []);
  }, [equityMetricConfigs, response?.metrics]);

  const runSettingsSummary = useMemo(() => {
    if (!lastRunConfig) return [] as InfoTag[];
    const indicators = lastRunConfig.indicators || {};
    return [
      { label: "Range", value: `${lastRunConfig.start} → ${lastRunConfig.end}` },
      { label: "Capital", value: optionalCurrency(lastRunConfig.capital) },
      { label: "Fee", value: typeof lastRunConfig.fee_bps === "number" ? `${formatNumber(lastRunConfig.fee_bps, 1)} bp` : "—" },
      { label: "Hold", value: typeof lastRunConfig.hold_days === "number" ? `${formatNumber(lastRunConfig.hold_days, 0)} d` : "—" },
      {
        label: "Max Hz",
        value: typeof indicators.max_horizon === "number" ? `${formatNumber(indicators.max_horizon, 0)} d` : "—",
      },
      {
        label: "Stop",
        value: optionalPercent(lastRunConfig.stop_loss_pct),
      },
      {
        label: "Take",
        value: optionalPercent(lastRunConfig.take_profit_pct),
      },
    ];
  }, [lastRunConfig, optionalCurrency, optionalPercent]);

  const universeSummary = useMemo(() => {
    if (!lastRunConfig?.filters) {
      return [{ label: "Filters", value: "None" }];
    }
    const { filters } = lastRunConfig;
    const items: InfoTag[] = [];
    if (filters.sectors && filters.sectors.length) {
      items.push({ label: "Sectors", value: filters.sectors.join(" · ") });
    }
    if (typeof filters.mcap_min === "number") {
      items.push({ label: "Cap ≥", value: optionalCurrency(filters.mcap_min) });
    }
    if (typeof filters.mcap_max === "number") {
      items.push({ label: "Cap ≤", value: optionalCurrency(filters.mcap_max) });
    }
    if (filters.exclude_tickers && filters.exclude_tickers.length) {
      items.push({ label: "Exclude", value: filters.exclude_tickers.join(", ") });
    }
    return items.length ? items : [{ label: "Filters", value: "None" }];
  }, [lastRunConfig, optionalCurrency]);


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
                        height={compactMode ? 320 : 360}
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
                      {lastRunConfig &&
                        (runSettingsSummary.length || universeSummary.length) && (
                        <div className="run-summary">
                          {runSettingsSummary.length > 0 && (
                            <div className="run-summary__section">
                              <div className="run-summary__title">Run Settings</div>
                              <div className="run-summary__grid">
                                {runSettingsSummary.map((item) => (
                                  <div className="run-summary__item" key={`run-${item.label}`}>
                                    <span className="run-summary__label">{item.label}</span>
                                    <span className="run-summary__value">{item.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="run-summary__section">
                            <div className="run-summary__title">Universe Filters</div>
                            <div className="run-summary__grid">
                              {universeSummary.map((item) => (
                                <div className="run-summary__item" key={`filter-${item.label}-${item.value}`}>
                                  <span className="run-summary__label">{item.label}</span>
                                  <span className="run-summary__value">{item.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </Card>
                  )}

                  <Card className="result-card equity-card" size="small">
                    <div className="card-header">
                      <Title level={4}>Equity Curve</Title>
                    </div>
                    <EquityChart
                      data={response.equity_curve}
                      loading={loading}
                      compact
                      height={compactMode ? 320 : 360}
                    />
                    {response.indicator_statistics && (
                      <div className="indicator-stats">
                        <div className="indicator-stats__header">Indicator Statistics</div>
                        <IndicatorStatsTable stats={response.indicator_statistics} compact />
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
