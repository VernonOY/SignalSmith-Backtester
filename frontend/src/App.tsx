import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, ConfigProvider, Space, Typography, message, theme } from "antd";
import html2canvas from "html2canvas";
import SidebarForm from "./components/SidebarForm";
import { BacktestRequest, BacktestResponse, Filters } from "./types";
import { api } from "./api/client";
import HistogramChart from "./components/HistogramChart";
import IndicatorStatsTable from "./components/IndicatorStatsTable";
import EquityChart from "./components/EquityChart";
import KPIBar, { KPIEntry } from "./components/KPIBar";
import { formatCurrency, formatNumber, formatPercent } from "./utils/format";

const { Title, Text } = Typography;

interface InfoTag {
  label: string;
  value: string;
}

interface MetricConfig {
  key: string;
  label: string;
  format: (value: number) => string;
}

const KPI_METRICS: MetricConfig[] = [
  { key: "sharpe", label: "Sharpe", format: (value) => value.toFixed(2) },
  { key: "annualized_return", label: "Ann Ret", format: (value) => formatPercent(value, 2) },
  { key: "annualized_vol", label: "Ann Vol", format: (value) => formatPercent(value, 2) },
  { key: "max_drawdown", label: "Max DD", format: (value) => formatPercent(value, 2) },
  { key: "sortino", label: "Sortino", format: (value) => value.toFixed(2) },
  { key: "win_rate", label: "Win %", format: (value) => formatPercent(value, 2) },
  { key: "avg_trade_return", label: "Avg Trd", format: (value) => formatPercent(value, 2) },
];

const formatFilters = (filters?: Filters | null): InfoTag[] => {
  if (!filters) return [];
  const tags: InfoTag[] = [];
  if (filters.sectors && filters.sectors.length) {
    tags.push({ label: "Sec", value: filters.sectors.join("|") });
  }
  if (typeof filters.mcap_min === "number") {
    tags.push({ label: "Cap ≥", value: formatCurrency(filters.mcap_min, 0) });
  }
  if (typeof filters.mcap_max === "number") {
    tags.push({ label: "Cap ≤", value: formatCurrency(filters.mcap_max, 0) });
  }
  if (filters.exclude_tickers && filters.exclude_tickers.length) {
    tags.push({ label: "Ex", value: filters.exclude_tickers.join("|") });
  }
  return tags;
};

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
      document.body.style.overflow = "hidden";
    } else {
      root.removeAttribute("data-compact");
      document.body.style.overflow = "auto";
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

  const handleToggleCompact = useCallback(() => {
    fitToSinglePage(!compactMode);
  }, [compactMode, fitToSinglePage]);

  const handleExportScreenshot = useCallback(async () => {
    const container = dashboardRef.current;
    if (!container) return;
    const wasCompact = compactMode;
    fitToSinglePage(true);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const canvas = await html2canvas(container, {
      backgroundColor: "#eef1ff",
      scale: window.devicePixelRatio,
    });
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "signalsmith-dashboard.png";
    link.click();
    if (!wasCompact) {
      fitToSinglePage(false);
    }
  }, [compactMode, fitToSinglePage]);

  const holdDaysDisplay =
    lastRunConfig?.hold_days !== undefined && lastRunConfig?.hold_days !== null
      ? `${formatNumber(lastRunConfig.hold_days, 0)}d`
      : "—";
  const feeDisplay =
    lastRunConfig?.fee_bps !== undefined && lastRunConfig?.fee_bps !== null
      ? `${formatNumber(lastRunConfig.fee_bps, 1)}bp`
      : "—";
  const binsDisplay =
    response?.histogram?.bin_count !== undefined && response?.histogram?.bin_count !== null
      ? formatNumber(response.histogram.bin_count, 0)
      : lastRunConfig?.hist_bins !== undefined && lastRunConfig?.hist_bins !== null
        ? formatNumber(lastRunConfig.hist_bins, 0)
        : "—";

  const histogramInfoItems: InfoTag[] = response?.histogram
    ? [
        {
          label: "Range",
          value: lastRunConfig ? `${lastRunConfig.start}→${lastRunConfig.end}` : "—",
        },
        { label: "Hz", value: `${response.histogram.horizon}d` },
        { label: "Hold", value: holdDaysDisplay },
        { label: "Fee", value: feeDisplay },
        { label: "Bins", value: binsDisplay },
      ]
    : [];

  const universeFilterTags = formatFilters(lastRunConfig?.filters);

  const kpiEntries: KPIEntry[] = useMemo(() => {
    if (!response?.metrics) return [];
    const base = KPI_METRICS.reduce<KPIEntry[]>((acc, config) => {
      const rawValue = response.metrics?.[config.key];
      if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
        return acc;
      }
      acc.push({
        key: config.key,
        label: config.label,
        value: config.format(rawValue),
      });
      return acc;
    }, []);
    const sampleSize = response.histogram?.sample_size;
    if (typeof sampleSize === "number" && !Number.isNaN(sampleSize)) {
      base.unshift({ key: "samples", label: "Samples", value: formatNumber(sampleSize, 0) });
    }
    return base;
  }, [response?.metrics, response?.histogram?.sample_size]);

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
            <Text type="secondary">One-page performance, distribution, and indicator diagnostics.</Text>
          </div>
          <Space className="dashboard__actions" size={8}>
            <Button size="small" onClick={handleToggleCompact}>
              {compactMode ? "Relax Layout" : "Compact Layout"}
            </Button>
            <Button size="small" type="primary" onClick={handleExportScreenshot}>
              Export Screenshot
            </Button>
          </Space>
        </header>

        <div className="dashboard__body">
          <aside className="dashboard__sidebar">
            <SidebarForm loading={loading} onSubmit={handleSubmit} compact={compactMode} />
          </aside>

          <main className="dashboard__content">
            {response ? (
              <>
                {kpiEntries.length > 0 && <KPIBar entries={kpiEntries} compact />}

                <div className="dashboard__charts">
                  {response.histogram && (
                    <Card className="result-card histogram-card" size="small">
                      <div className="card-header">
                        <Title level={4}>Return Distribution</Title>
                        {(histogramInfoItems.length > 0 || universeFilterTags.length > 0) && (
                          <div className="info-line" role="list">
                            {[...histogramInfoItems, ...universeFilterTags].map((item) => (
                              <span
                                role="listitem"
                                key={`${item.label}-${item.value}`}
                                className="info-tag"
                                title={`${item.label}: ${item.value}`}
                              >
                                <span className="info-tag__label">{item.label}</span>
                                <span className="info-tag__value">{item.value}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <HistogramChart data={response.histogram} loading={loading} compact />
                    </Card>
                  )}

                  <Card className="result-card equity-card" size="small">
                    <div className="card-header">
                      <Title level={4}>Equity Curve</Title>
                    </div>
                    <EquityChart data={response.equity_curve} loading={loading} compact />
                  </Card>
                </div>

                {response.indicator_statistics && (
                  <Card className="result-card table-card" size="small">
                    <div className="card-header">
                      <Title level={4}>Indicator Statistics</Title>
                    </div>
                    <IndicatorStatsTable stats={response.indicator_statistics} compact />
                  </Card>
                )}
              </>
            ) : (
              <Card className="result-card intro-card" size="small">
                <Title level={4}>Configure &amp; Run</Title>
                <Text type="secondary">
                  Adjust parameters on the left and run the engine to populate the dashboard.
                </Text>
              </Card>
            )}
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
