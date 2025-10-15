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

  const runSettingsSummary = useMemo(() => {
    if (!lastRunConfig) return [] as InfoTag[];
    const indicators = lastRunConfig.indicators || {};
    return [
      { label: "Range", value: `${lastRunConfig.start} → ${lastRunConfig.end}` },
      { label: "Capital", value: optionalCurrency(lastRunConfig.capital) },
      { label: "Fee", value: typeof lastRunConfig.fee_bps === "number" ? `${formatNumber(lastRunConfig.fee_bps, 1)} bp` : "—" },
      {
        label: "Hold",
        value: response ? `${formatNumber(response.hold_days, 0)} d` : "—",
      },
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
  }, [lastRunConfig, optionalCurrency, optionalPercent, response]);

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

  const signalSummary = useMemo(() => {
    if (!lastRunConfig?.indicators) {
      return [{ label: "Signals", value: "None" }];
    }

    const indicators = lastRunConfig.indicators as Record<string, any>;
    const items: InfoTag[] = [];

    if (indicators.policy) {
      const formatted = indicators.policy === "any" ? "Any" : String(indicators.policy);
      items.push({ label: "Policy", value: formatted });
    }

    if (typeof indicators.atleast_k === "number") {
      items.push({ label: "At Least", value: formatNumber(indicators.atleast_k, 0) });
    }

    if (typeof indicators.bin_width === "number") {
      items.push({ label: "Bin Width", value: formatPercent(indicators.bin_width, 1) });
    }

    const addIndicator = (
      name: string,
      config: any,
      formatter: (cfg: any) => string | undefined | null
    ) => {
      if (!config || config.use === false) return;
      const value = formatter(config);
      if (!value) return;
      items.push({ label: name, value });
    };

    addIndicator("RSI", indicators.rsi, (cfg) => {
      const pieces = [`n=${formatNumber(cfg.n, 0)}`];
      if (cfg.rule === "oversold" && typeof cfg.oversold === "number") {
        pieces.push(`OS≤${formatNumber(cfg.oversold, 0)}`);
      }
      if (cfg.rule === "overbought" && typeof cfg.overbought === "number") {
        pieces.push(`OB≥${formatNumber(cfg.overbought, 0)}`);
      }
      return pieces.join(" · ");
    });

    addIndicator("MACD", indicators.macd, (cfg) => {
      if (typeof cfg.fast !== "number" || typeof cfg.slow !== "number" || typeof cfg.signal !== "number") {
        return undefined;
      }
      const rule = cfg.rule ? String(cfg.rule).toUpperCase() : "—";
      return `${formatNumber(cfg.fast, 0)}/${formatNumber(cfg.slow, 0)}/${formatNumber(cfg.signal, 0)} · ${rule}`;
    });

    addIndicator("OBV", indicators.obv, (cfg) => (cfg.rule ? String(cfg.rule).toUpperCase() : "—"));

    addIndicator("EMA", indicators.ema, (cfg) => {
      if (typeof cfg.short !== "number" || typeof cfg.long !== "number") return undefined;
      return `${formatNumber(cfg.short, 0)}/${formatNumber(cfg.long, 0)}`;
    });

    addIndicator("ADX", indicators.adx, (cfg) => {
      if (typeof cfg.n !== "number" || typeof cfg.min !== "number") return undefined;
      return `n=${formatNumber(cfg.n, 0)} · ≥${formatNumber(cfg.min, 0)}`;
    });

    addIndicator("Aroon", indicators.aroon, (cfg) => {
      if (
        typeof cfg.n !== "number" ||
        typeof cfg.up !== "number" ||
        typeof cfg.down !== "number"
      ) {
        return undefined;
      }
      return `n=${formatNumber(cfg.n, 0)} · ↑${formatNumber(cfg.up, 0)} / ↓${formatNumber(cfg.down, 0)}`;
    });

    addIndicator("Stoch", indicators.stoch, (cfg) => {
      if (typeof cfg.k !== "number" || typeof cfg.d !== "number") return undefined;
      const base = `K${formatNumber(cfg.k, 0)}/D${formatNumber(cfg.d, 0)}`;
      const rule = cfg.rule ? ` · ${String(cfg.rule).toUpperCase()}` : "";
      const threshold = typeof cfg.threshold === "number" ? ` · ${formatNumber(cfg.threshold, 0)}` : "";
      return `${base}${rule}${threshold}`;
    });

    return items.length ? items : [{ label: "Signals", value: "None" }];
  }, [lastRunConfig]);


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
                    <Card className="result-card resizable-card histogram-card" size="small">
                      <div className="card-header">
                        <Title level={4}>Return Distribution</Title>
                      </div>
                      <HistogramChart
                        data={response.histogram}
                        loading={loading}
                        compact
                        height={compactMode ? 360 : 440}
                      />
                    </Card>
                  )}

                  {showDetailsCard && (
                    <Card className="result-card resizable-card details-card" size="small">
                      {hasIndicatorStats && (
                        <>
                          <div className="card-header">
                            <Title level={4}>Indicator Statistics</Title>
                          </div>
                          <IndicatorStatsTable stats={response!.indicator_statistics!} compact />
                        </>
                      )}
                      {(hasRunSettings || hasUniverseDetails || hasSignalDetails) && (
                        <div className="run-summary">
                          {hasRunSettings && (
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
                          {hasUniverseDetails && (
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
                          )}
                          {hasSignalDetails && (
                            <div className="run-summary__section">
                              <div className="run-summary__title">Signal Rules</div>
                              <div className="run-summary__grid">
                                {signalSummary.map((item) => (
                                  <div className="run-summary__item" key={`signal-${item.label}-${item.value}`}>
                                    <span className="run-summary__label">{item.label}</span>
                                    <span className="run-summary__value">{item.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  )}

                  <Card className="result-card resizable-card equity-card" size="small">
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
                            style={{ minWidth: 96 }}
                            disabled={loading}
                          />
                        </div>
                      )}
                    </div>
                    <EquityChart
                      data={equitySeries}
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
                  </Card>
                </div>
              ) : (
                <Card className="result-card resizable-card intro-card" size="small">
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
