import { useState } from "react";
import { ConfigProvider, theme, message, Typography, Card } from "antd";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import SidebarForm from "./components/SidebarForm";
import { BacktestRequest, BacktestResponse, Filters } from "./types";
import { api } from "./api/client";
import HistogramChart from "./components/HistogramChart";
import IndicatorStatsTable from "./components/IndicatorStatsTable";
import EquityChart from "./components/EquityChart";
import { formatCurrency, formatNumber } from "./utils/format";

const { Title, Text } = Typography;

interface InfoTag {
  label: string;
  value: string;
}

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

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.compactAlgorithm,
        token: {
          borderRadius: 8,
        },
      }}
    >
      <div className="app-shell">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={28} minSize={18} maxSize={35} className="panel panel--sidebar">
            <div className="sidebar-panel">
              <SidebarForm loading={loading} onSubmit={handleSubmit} />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={72} minSize={40} className="panel panel--content">
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
                  {response.histogram && (
                    <Card className="result-card histogram-card">
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

                  <Card className="result-card">
                    <div className="card-header">
                      <Title level={4}>Equity Curve</Title>
                    </div>
                    <EquityChart data={response.equity_curve} loading={loading} />
                  </Card>

                  {response.indicator_statistics && (
                    <Card className="result-card">
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
    </ConfigProvider>
  );
};

export default App;
