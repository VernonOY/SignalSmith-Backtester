import { useState } from "react";
import { ConfigProvider, theme, message, Typography, Card, Button, Space } from "antd";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import SidebarForm from "./components/SidebarForm";
import { BacktestRequest, BacktestResponse } from "./types";
import { api } from "./api/client";
import EquityChart from "./components/EquityChart";
import DrawdownChart from "./components/DrawdownChart";
import SignalChart from "./components/SignalChart";
import MetricsTable from "./components/MetricsTable";
import TradesTable from "./components/TradesTable";
import HistogramChart from "./components/HistogramChart";
import IndicatorStatsTable from "./components/IndicatorStatsTable";
import { downloadCSV, downloadJSON } from "./utils/download";

const { Title, Text } = Typography;

const App = () => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<BacktestResponse | null>(null);

  const handleSubmit = async (payload: BacktestRequest) => {
    try {
      setLoading(true);
      const { data } = await api.post<BacktestResponse>("/run_backtest", payload);
      setResponse(data);
      message.success("Backtest complete");
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error.message;
      message.error(detail ?? "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadEquity = () => {
    if (!response) return;
    downloadCSV(
      "equity_curve.csv",
      ["date", "value"],
      response.equity_curve.dates.map((d, i) => [d, response.equity_curve.values[i]])
    );
  };

  const handleDownloadDrawdown = () => {
    if (!response) return;
    downloadCSV(
      "drawdown_curve.csv",
      ["date", "value"],
      response.drawdown_curve.dates.map((d, i) => [d, response.drawdown_curve.values[i]])
    );
  };

  const handleDownloadSignals = () => {
    if (!response || !response.signals?.length) return;
    downloadCSV(
      "signals.csv",
      ["date", "type", "price", "size", "symbol"],
      response.signals.map((s) => [s.date, s.type, s.price ?? "", s.size ?? "", s.symbol ?? ""])
    );
  };

  const handleDownloadMetrics = () => {
    if (!response) return;
    downloadCSV(
      "metrics.csv",
      ["metric", "value"],
      Object.entries(response.metrics).map(([key, value]) => [key, value])
    );
  };

  const handleDownloadTrades = () => {
    if (!response || !response.trades?.length) return;
    downloadCSV(
      "trades.csv",
      ["symbol", "enter_date", "enter_price", "exit_date", "exit_price", "pnl", "ret"],
      response.trades.map((t) => [
        t.symbol ?? "",
        t.enter_date,
        t.enter_price,
        t.exit_date,
        t.exit_price,
        t.pnl,
        t.ret,
      ])
    );
  };

  const handleDownloadSummary = () => {
    if (!response) return;
    downloadJSON("backtest_summary.json", response);
  };

  const handleDownloadHistogram = () => {
    if (!response?.histogram) return;
    downloadCSV(
      "histogram.csv",
      ["bin_start", "bin_end", "count"],
      response.histogram.buckets.map((bucket) => [bucket.bin_start, bucket.bin_end, bucket.count])
    );
  };

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
          <Panel defaultSize={24} minSize={15} maxSize={35} className="panel panel--sidebar">
            <div className="sidebar-panel">
              <SidebarForm loading={loading} onSubmit={handleSubmit} />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={76} minSize={40} className="panel panel--content">
            <div className="results-panel">
              {!response && (
                <Card className="result-card intro-card">
                  <Title level={3}>SignalSmith Backtester</Title>
                  <Text type="secondary">
                    Configure parameters on the left and run the backtest to see equity, drawdown and trade analytics.
                  </Text>
                </Card>
              )}

              {response && (
                <div className="results-container">
                  <Card className="result-card">
                    <div className="card-header">
                      <Title level={3}>Aggregated Results</Title>
                      <Space>
                        <Button size="small" onClick={handleDownloadSummary}>
                          Download JSON
                        </Button>
                      </Space>
                    </div>
                    <div className="summary-stats">
                      <div>
                        <span>Universe size</span>
                        <strong>{response.universe_size}</strong>
                      </div>
                      <div>
                        <span>Trades generated</span>
                        <strong>{response.trades_count}</strong>
                      </div>
                      {response.histogram && (
                        <div>
                          <span>Histogram horizon</span>
                          <strong>{`${response.histogram.horizon}d`}</strong>
                        </div>
                      )}
                    </div>
                  </Card>

                  <div className="result-grid">
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Equity Curve</Title>
                        <Button size="small" onClick={handleDownloadEquity}>
                          Download CSV
                        </Button>
                      </div>
                      <EquityChart data={response.equity_curve} loading={loading} />
                    </Card>
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Drawdown</Title>
                        <Button size="small" onClick={handleDownloadDrawdown}>
                          Download CSV
                        </Button>
                      </div>
                      <DrawdownChart data={response.drawdown_curve} loading={loading} />
                    </Card>
                  </div>

                  <Card className="result-card">
                    <div className="card-header">
                      <Title level={4}>Signals &amp; Price</Title>
                      <Button size="small" onClick={handleDownloadSignals} disabled={!response.signals?.length}>
                        Download CSV
                      </Button>
                    </div>
                    <SignalChart
                      priceSeries={response.price_series ?? response.equity_curve}
                      signals={response.signals ?? []}
                    />
                  </Card>

                  <Card className="result-card">
                    <div className="card-header">
                      <Title level={4}>Performance Metrics</Title>
                      <Button size="small" onClick={handleDownloadMetrics}>
                        Download CSV
                      </Button>
                    </div>
                    <MetricsTable metrics={response.metrics} />
                  </Card>

                  {response.histogram && (
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Return Distribution</Title>
                        <Button size="small" onClick={handleDownloadHistogram}>
                          Download CSV
                        </Button>
                      </div>
                      <HistogramChart data={response.histogram} loading={loading} />
                    </Card>
                  )}

                  {response.indicator_statistics && Object.keys(response.indicator_statistics).length > 0 && (
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Indicator Statistics</Title>
                      </div>
                      <IndicatorStatsTable stats={response.indicator_statistics} />
                    </Card>
                  )}

                  <Card className="result-card">
                    <div className="card-header">
                      <Title level={4}>Trades</Title>
                      <Button
                        size="small"
                        onClick={handleDownloadTrades}
                        disabled={!response.trades?.length}
                      >
                        Download CSV
                      </Button>
                    </div>
                    <TradesTable trades={response.trades ?? []} />
                  </Card>
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
