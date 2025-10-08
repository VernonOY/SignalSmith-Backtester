import { useState } from "react";
import { ConfigProvider, theme, message, Typography, Card } from "antd";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import SidebarForm from "./components/SidebarForm";
import { BacktestRequest, BacktestResponse, Filters } from "./types";
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

interface MetricConfig {
  key: string;
  label: string;
  format: (value: number) => string;
}

const EQUITY_METRICS: MetricConfig[] = [
  { key: "sharpe", label: "Sharpe Ratio", format: (value) => value.toFixed(2) },
  { key: "sortino", label: "Sortino Ratio", format: (value) => value.toFixed(2) },
  { key: "annualized_return", label: "Annualized Return", format: (value) => formatPercent(value, 2) },
  { key: "annualized_vol", label: "Annualized Volatility", format: (value) => formatPercent(value, 2) },
  { key: "max_drawdown", label: "Max Drawdown", format: (value) => formatPercent(value, 2) },
  { key: "win_rate", label: "Win Rate", format: (value) => formatPercent(value, 2) },
  { key: "avg_trade_return", label: "Avg Trade Return", format: (value) => formatPercent(value, 2) },
];

const formatFilters = (filters?: Filters | null): InfoTag[] => {
  if (!filters) return [];
  const tags: InfoTag[] = [];
  if (filters.sectors && filters.sectors.length) {
    tags.push({ label: "Sectors", value: filters.sectors.join(", ") });
  }
  if (typeof filters.mcap_min === "number") {
    tags.push({ label: "Market Cap Min", value: formatCurrency(filters.mcap_min, 0) });
  }
  if (typeof filters.mcap_max === "number") {
    tags.push({ label: "Market Cap Max", value: formatCurrency(filters.mcap_max, 0) });
  }
  if (filters.exclude_tickers && filters.exclude_tickers.length) {
    tags.push({ label: "Excluded", value: filters.exclude_tickers.join(", ") });
  }
  return tags;
};

const App = () => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<BacktestResponse | null>(null);
  const [lastRunConfig, setLastRunConfig] = useState<BacktestRequest | null>(null);

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

  const holdDaysDisplay =
    lastRunConfig?.hold_days !== undefined && lastRunConfig?.hold_days !== null
      ? formatNumber(lastRunConfig.hold_days, 0)
      : "—";
  const feeDisplay =
    lastRunConfig?.fee_bps !== undefined && lastRunConfig?.fee_bps !== null
      ? `${formatNumber(lastRunConfig.fee_bps, 2)} bps`
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
          label: "Window",
          value: lastRunConfig ? `${lastRunConfig.start} → ${lastRunConfig.end}` : "—",
        },
        { label: "Horizon", value: `${response.histogram.horizon}d` },
        { label: "Hold Days", value: holdDaysDisplay },
        { label: "Fee", value: feeDisplay },
        { label: "Bins", value: binsDisplay },
      ]
    : [];

  const universeFilterTags = formatFilters(lastRunConfig?.filters);

  const highlightMetrics: { key: string; label: string; value: string }[] = response?.metrics
    ? (EQUITY_METRICS.map((config) => {
        const rawValue = response.metrics[config.key];
        if (typeof rawValue !== "number" || Number.isNaN(rawValue)) {
          return null;
        }
        return {
          key: config.key,
          label: config.label,
          value: config.format(rawValue),
        };
      }).filter(Boolean) as { key: string; label: string; value: string }[])
    : [];

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.compactAlgorithm,
        token: {
          borderRadius: 8,
        },
      }}
    >
      <div className="app-scale-wrapper">
        <div className="app-shell">
          <PanelGroup direction="horizontal">
            <Panel defaultSize={35} minSize={30} maxSize={65} className="panel panel--sidebar">
              <div className="sidebar-panel">
                <SidebarForm loading={loading} onSubmit={handleSubmit} />
              </div>
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel defaultSize={65} minSize={35} className="panel panel--content">
              <div className="results-panel">
                {!response && (
                  <Card className="result-card intro-card">
                    <Title level={3}>SignalSmith Backtester</Title>
                    <Text type="secondary">
                      Configure parameters on the left and run the backtest to see equity performance and distribution analytics.
                    </Text>
                  </Card>
                )}

                {response && (
                  <div className="results-container">
                    <div className="results-grid results-grid--charts">
                      {response.histogram && (
                        <Card className="result-card result-card--chart histogram-card">
                          <div className="card-header">
                            <Title level={4}>Return Distribution</Title>
                          </div>
                          {(histogramInfoItems.length > 0 || universeFilterTags.length > 0) && (
                            <div className="histogram-info">
                              {[...histogramInfoItems, ...universeFilterTags].map((item) => (
                                <div key={`${item.label}-${item.value}`} className="info-pill">
                                  <span className="info-pill__label">{item.label}</span>
                                  <span className="info-pill__value">{item.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <HistogramChart data={response.histogram} loading={loading} />
                        </Card>
                      )}

                      <Card className="result-card result-card--chart">
                        <div className="card-header">
                          <Title level={4}>Equity Curve</Title>
                        </div>
                        <EquityChart data={response.equity_curve} loading={loading} />
                        {highlightMetrics.length > 0 && (
                          <div className="metrics-grid metrics-grid--compact equity-metrics">
                            {highlightMetrics.map((metric) => (
                              <div key={metric.key} className="metrics-item metrics-item--compact">
                                <h4>{metric.label}</h4>
                                <span>{metric.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>

                    {response.indicator_statistics && (
                      <Card className="result-card result-card--wide">
                        <div className="card-header">
                          <Title level={4}>Indicator Statistics</Title>
                        </div>
                        <IndicatorStatsTable stats={response.indicator_statistics} />
                      </Card>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          </PanelGroup>
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
