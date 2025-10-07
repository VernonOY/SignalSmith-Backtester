import { useRef, useState } from "react";
import { ConfigProvider, theme, message, Typography, Card, Button, Space, Switch, Modal } from "antd";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import SidebarForm from "./components/SidebarForm";
import { BacktestRequest, BacktestResponse } from "./types";
import { api } from "./api/client";
import EquityChart from "./components/EquityChart";
import DrawdownChart from "./components/DrawdownChart";
import SignalChart from "./components/SignalChart";
import MetricsTable from "./components/MetricsTable";
import TradesTable from "./components/TradesTable";
import type { ECharts } from "echarts";
import HistogramChart from "./components/HistogramChart";
import IndicatorStatsTable from "./components/IndicatorStatsTable";
import { downloadCSV, downloadJSON, downloadImage, createCSVContent } from "./utils/download";
import { formatCurrency, formatNumber, formatPercent } from "./utils/format";
import { buildSelectionRows } from "./utils/report";

const { Title, Text, Paragraph } = Typography;

const App = () => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<BacktestResponse | null>(null);
  const [lastRunConfig, setLastRunConfig] = useState<BacktestRequest | null>(null);
  const [lastFormValues, setLastFormValues] = useState<Record<string, any> | null>(null);
  const [signalsInfoVisible, setSignalsInfoVisible] = useState(false);
  const [showPriceLine, setShowPriceLine] = useState(true);
  const [showBuySignals, setShowBuySignals] = useState(true);
  const [showSellSignals, setShowSellSignals] = useState(true);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const equityChartRef = useRef<ECharts | null>(null);
  const drawdownChartRef = useRef<ECharts | null>(null);
  const signalChartRef = useRef<ECharts | null>(null);
  const histogramChartRef = useRef<ECharts | null>(null);

  const handleSubmit = async (payload: BacktestRequest, rawValues: any) => {
    try {
      setLoading(true);
      equityChartRef.current = null;
      drawdownChartRef.current = null;
      signalChartRef.current = null;
      histogramChartRef.current = null;
      const { data } = await api.post<BacktestResponse>("/run_backtest", payload);
      setResponse(data);
      setLastRunConfig(payload);
      setLastFormValues(rawValues);
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

  const handleDownloadHistogramImage = () => {
    const chart = histogramChartRef.current;
    if (!chart) return;
    const dataUrl = chart.getDataURL({ type: "png", backgroundColor: "#ffffff" });
    downloadImage("histogram.png", dataUrl);
  };

  const handleDownloadIndicatorStats = () => {
    if (!response?.indicator_statistics) return;
    const rows: Array<Array<string | number>> = [];
    Object.entries(response.indicator_statistics).forEach(([horizon, metrics]) => {
      Object.entries(metrics).forEach(([metric, value]) => {
        rows.push([horizon, metric, value]);
      });
    });
    downloadCSV("indicator_statistics.csv", ["horizon", "metric", "value"], rows);
  };

  const handleDownloadReport = () => {
    if (!response) {
      message.warning("Run the backtest before downloading the report");
      return;
    }

    const escapeHtml = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const captureChart = (chart: ECharts | null) => {
      if (!chart) return null;
      try {
        return chart.getDataURL({ type: "png", backgroundColor: "#ffffff" });
      } catch (error) {
        console.error("Failed to capture chart", error);
        return null;
      }
    };

    const selectionRows = lastFormValues ? buildSelectionRows(lastFormValues) : [];
    const metricsRows = Object.entries(response.metrics);
    const equityCurve = response.equity_curve;
    const drawdownCurve = response.drawdown_curve;
    const signalRows = (response.signals ?? []).map((s) => [
      s.date,
      s.type,
      s.price ?? "",
      s.size ?? "",
      s.symbol ?? "",
    ]);
    const tradeRows = (response.trades ?? []).map((t) => [
      t.symbol ?? "",
      t.enter_date,
      t.enter_price,
      t.exit_date,
      t.exit_price,
      t.pnl,
      t.ret,
    ]);
    const histogramRows = response.histogram
      ? response.histogram.buckets.map((bucket) => [
          bucket.bin_start,
          bucket.bin_end,
          bucket.count,
        ])
      : [];
    const indicatorRows: Array<Array<string | number>> = [];
    if (response.indicator_statistics) {
      Object.entries(response.indicator_statistics).forEach(([horizon, metrics]) => {
        Object.entries(metrics).forEach(([metric, value]) => {
          indicatorRows.push([horizon, metric, value]);
        });
      });
    }

    const sectionTable = (rows: Array<Array<string | number>>, headers: string[]) => {
      if (!rows.length) return "<p>No data available.</p>";
      const headerCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      const bodyRows = rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`)
              .join("")}</tr>`
        )
        .join("");
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    };

    const csvSection = (title: string, csv?: string | null) => {
      if (!csv) return "";
      return `
        <details open>
          <summary>${escapeHtml(title)}</summary>
          <pre>${escapeHtml(csv)}</pre>
        </details>
      `;
    };

    const equityCsv = equityCurve?.dates.length
      ? createCSVContent(
          ["date", "value"],
          equityCurve.dates.map((d, i) => [d, equityCurve.values[i]])
        )
      : null;
    const drawdownCsv = drawdownCurve?.dates.length
      ? createCSVContent(
          ["date", "value"],
          drawdownCurve.dates.map((d, i) => [d, drawdownCurve.values[i]])
        )
      : null;
    const signalsCsv = createCSVContent(["date", "type", "price", "size", "symbol"], signalRows);
    const tradesCsv = createCSVContent(
      ["symbol", "enter_date", "enter_price", "exit_date", "exit_price", "pnl", "ret"],
      tradeRows
    );
    const histogramCsv = histogramRows.length
      ? createCSVContent(["bin_start", "bin_end", "count"], histogramRows)
      : null;
    const indicatorCsv = indicatorRows.length
      ? createCSVContent(["horizon", "metric", "value"], indicatorRows)
      : null;

    const requestJson = lastRunConfig ? JSON.stringify(lastRunConfig, null, 2) : null;
    const responseJson = JSON.stringify(response, null, 2);

    const equityImage = captureChart(equityChartRef.current);
    const drawdownImage = captureChart(drawdownChartRef.current);
    const signalImage = captureChart(signalChartRef.current);
    const histogramImage = captureChart(histogramChartRef.current);

    const timestamp = new Date().toISOString();

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Backtest Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1 { margin-bottom: 4px; }
      h2 { margin-top: 32px; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; }
      th, td { border: 1px solid #cbd5f5; padding: 8px; text-align: left; font-size: 13px; }
      th { background: #eef2ff; }
      pre { background: #f8fafc; padding: 12px; border-radius: 8px; overflow-x: auto; }
      details { margin-top: 12px; }
      .charts { display: flex; flex-direction: column; gap: 32px; align-items: center; }
      .charts figure { margin: 0; width: 100%; max-width: 760px; }
      .charts img { width: 100%; height: auto; border: 1px solid #dbeafe; border-radius: 12px; box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08); }
      .charts figcaption { margin-top: 12px; text-align: center; font-weight: 600; color: #334155; }
    </style>
  </head>
  <body>
    <h1>Backtest Report</h1>
    <p>Generated at ${escapeHtml(timestamp)}</p>

    <section>
      <h2>Parameter Summary</h2>
      ${selectionRows.length
        ? sectionTable(selectionRows, ["Section", "Parameter", "Value"])
        : "<p>No parameter selections recorded.</p>"}
    </section>

    <section>
      <h2>Metrics</h2>
      ${metricsRows.length
        ? sectionTable(
            metricsRows.map(([label, value]) => [label, value]),
            ["Metric", "Value"]
          )
        : "<p>No metrics available.</p>"}
    </section>

    <section>
      <h2>Charts</h2>
      <div class="charts">
        ${equityImage ? `<figure><img src="${equityImage}" alt="Equity Curve" /><figcaption>Equity Curve</figcaption></figure>` : ""}
        ${drawdownImage ? `<figure><img src="${drawdownImage}" alt="Drawdown" /><figcaption>Drawdown</figcaption></figure>` : ""}
        ${signalImage ? `<figure><img src="${signalImage}" alt="Signals" /><figcaption>Signals & Price</figcaption></figure>` : ""}
        ${histogramImage ? `<figure><img src="${histogramImage}" alt="Histogram" /><figcaption>Return Distribution</figcaption></figure>` : ""}
      </div>
    </section>

    <section>
      <h2>Data Snapshots</h2>
      ${csvSection("Equity Curve (CSV)", equityCsv)}
      ${csvSection("Drawdown (CSV)", drawdownCsv)}
      ${csvSection("Signals (CSV)", signalsCsv)}
      ${csvSection("Trades (CSV)", tradesCsv)}
      ${csvSection("Histogram (CSV)", histogramCsv)}
      ${csvSection("Indicator Statistics (CSV)", indicatorCsv)}
    </section>

    <section>
      <h2>Raw Payloads</h2>
      ${requestJson
        ? `<details open><summary>Request Parameters</summary><pre>${escapeHtml(requestJson)}</pre></details>`
        : ""}
      <details open>
        <summary>Backtest Response</summary>
        <pre>${escapeHtml(responseJson)}</pre>
      </details>
    </section>
  </body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = `backtest-report-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    message.success("Report downloaded");
  };

  const histogramBins = response?.histogram?.bin_count ?? lastRunConfig?.hist_bins ?? null;
  const summaryItems = response
    ? [
        { label: "Universe size", value: formatNumber(response.universe_size, 0) },
        { label: "Trades generated", value: formatNumber(response.trades_count, 0) },
        { label: "Initial capital", value: formatCurrency(response.initial_capital, 0) },
        { label: "Ending equity", value: formatCurrency(response.ending_equity, 0) },
        { label: "Total return", value: formatPercent(response.total_return, 2) },
        { label: "Total fees", value: formatCurrency(response.total_fees, 0) },
        ...(response.histogram
          ? [{ label: "Histogram horizon", value: `${response.histogram.horizon}d` }]
          : []),
        ...(histogramBins !== null
          ? [{ label: "Histogram bins", value: formatNumber(histogramBins, 0) }]
          : []),
      ]
    : [];

  const capitalDisplay = formatCurrency(
    lastRunConfig?.capital ?? response?.initial_capital ?? 0,
    0,
  );
  const holdDaysDisplay =
    lastRunConfig?.hold_days !== undefined && lastRunConfig?.hold_days !== null
      ? formatNumber(lastRunConfig.hold_days, 0)
      : "—";
  const feeDisplay =
    lastRunConfig?.fee_bps !== undefined && lastRunConfig?.fee_bps !== null
      ? `${formatNumber(lastRunConfig.fee_bps, 2)} bps`
      : "—";
  const stopLossDisplay =
    lastRunConfig?.stop_loss_pct !== undefined && lastRunConfig?.stop_loss_pct !== null
      ? formatPercent(lastRunConfig.stop_loss_pct, 1)
      : "—";
  const takeProfitDisplay =
    lastRunConfig?.take_profit_pct !== undefined && lastRunConfig?.take_profit_pct !== null
      ? formatPercent(lastRunConfig.take_profit_pct, 1)
      : "—";
  const fallbackHistHorizon = lastRunConfig?.indicators?.hist_horizon as number | undefined;
  const histHorizonDisplay = response?.histogram
    ? `${response.histogram.horizon}d`
    : fallbackHistHorizon !== undefined && fallbackHistHorizon !== null
      ? `${fallbackHistHorizon}d`
      : "—";
  const binsDisplay = histogramBins !== null ? formatNumber(histogramBins, 0) : "—";

  const runSettingItems = lastRunConfig
    ? [
        { label: "Start date", value: lastRunConfig.start },
        { label: "End date", value: lastRunConfig.end },
        { label: "Initial capital", value: capitalDisplay },
        { label: "Hold days", value: holdDaysDisplay },
        { label: "Fee (bps)", value: feeDisplay },
        { label: "Stop loss", value: stopLossDisplay },
        { label: "Take profit", value: takeProfitDisplay },
        { label: "Histogram horizon", value: histHorizonDisplay },
        { label: "Histogram bins", value: binsDisplay },
      ]
    : [];

  const histogramInfoItems = response?.histogram
    ? [
        {
          label: "Window",
          value: lastRunConfig ? `${lastRunConfig.start} → ${lastRunConfig.end}` : "—",
        },
        { label: "Horizon", value: `${response.histogram.horizon}d` },
        { label: "Hold days", value: holdDaysDisplay },
        { label: "Fee", value: feeDisplay },
        { label: "Bins", value: binsDisplay },
      ]
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
      <div className="app-shell">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={22} minSize={15} maxSize={25} className="panel panel--sidebar">
            <div className="sidebar-panel">
              <SidebarForm loading={loading} onSubmit={handleSubmit} />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={78} minSize={40} className="panel panel--content">
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
                  <div className="results-top-grid">
                    <Card
                      className={`result-card overview-card${overviewExpanded ? " overview-card--expanded" : ""}`}
                    >
                      <div className="card-header card-header--compact">
                        <Title level={4}>Backtest Overview</Title>
                        <Space size={8} wrap align="center">
                          <Button size="small" type="primary" onClick={handleDownloadReport}>
                            Download Report
                          </Button>
                          <Button size="small" onClick={handleDownloadSummary}>
                            Download JSON
                          </Button>
                          <Button size="small" onClick={handleDownloadMetrics}>
                            Metrics CSV
                          </Button>
                          <Button
                            size="small"
                            type="text"
                            onClick={() => setOverviewExpanded((prev) => !prev)}
                          >
                            {overviewExpanded ? "Hide details" : "Show details"}
                          </Button>
                        </Space>
                      </div>
                      <div className="overview-summary overview-summary--compact">
                        {summaryItems.map((item) => (
                          <div key={item.label} className="summary-item">
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                      {overviewExpanded && (
                        <div className="overview-details">
                          {runSettingItems.length > 0 && (
                            <div className="overview-settings">
                              <h4>Run settings</h4>
                              <dl className="settings-list">
                                {runSettingItems.map((item) => (
                                  <div key={item.label} className="settings-list__item">
                                    <dt>{item.label}</dt>
                                    <dd>{item.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                          <MetricsTable metrics={response.metrics} />
                        </div>
                      )}
                    </Card>

                    {response.histogram && (
                      <Card className="result-card histogram-card">
                        <div className="card-header">
                          <Title level={4}>Return Distribution</Title>
                          <Space size={8}>
                            <Button size="small" onClick={handleDownloadHistogram}>
                              Download CSV
                            </Button>
                            <Button size="small" onClick={handleDownloadHistogramImage}>
                              Download PNG
                            </Button>
                          </Space>
                        </div>
                        {histogramInfoItems.length > 0 && (
                          <div className="histogram-info">
                            {histogramInfoItems.map((item) => (
                              <div key={item.label} className="info-pill">
                                <span className="info-pill__label">{item.label}</span>
                                <span className="info-pill__value">{item.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <HistogramChart
                          data={response.histogram}
                          loading={loading}
                          height={360}
                          onReady={(instance) => {
                            histogramChartRef.current = instance;
                          }}
                        />
                      </Card>
                    )}
                  </div>

                  {response.indicator_statistics && Object.keys(response.indicator_statistics).length > 0 && (
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Indicator Statistics</Title>
                        <Button size="small" onClick={handleDownloadIndicatorStats}>
                          Download CSV
                        </Button>
                      </div>
                      <IndicatorStatsTable stats={response.indicator_statistics} />
                    </Card>
                  )}

                  <div className="result-grid">
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Equity Curve</Title>
                        <Button size="small" onClick={handleDownloadEquity}>
                          Download CSV
                        </Button>
                      </div>
                      <EquityChart
                        data={response.equity_curve}
                        loading={loading}
                        onReady={(instance) => {
                          equityChartRef.current = instance;
                        }}
                      />
                    </Card>
                    <Card className="result-card">
                      <div className="card-header">
                        <Title level={4}>Drawdown</Title>
                        <Button size="small" onClick={handleDownloadDrawdown}>
                          Download CSV
                        </Button>
                      </div>
                      <DrawdownChart
                        data={response.drawdown_curve}
                        loading={loading}
                        onReady={(instance) => {
                          drawdownChartRef.current = instance;
                        }}
                      />
                    </Card>
                  </div>

                  <Card className="result-card">
                    <div className="card-header">
                      <Title level={4}>Signals &amp; Price</Title>
                      <Space size={12} wrap align="center">
                        <Button type="link" size="small" onClick={() => setSignalsInfoVisible(true)}>
                          Describe
                        </Button>
                        <Space size={4} align="center">
                          <span>Price</span>
                          <Switch size="small" checked={showPriceLine} onChange={setShowPriceLine} />
                        </Space>
                        <Space size={4} align="center">
                          <span>Buys</span>
                          <Switch size="small" checked={showBuySignals} onChange={setShowBuySignals} />
                        </Space>
                        <Space size={4} align="center">
                          <span>Sells</span>
                          <Switch size="small" checked={showSellSignals} onChange={setShowSellSignals} />
                        </Space>
                        <Button size="small" onClick={handleDownloadSignals} disabled={!response.signals?.length}>
                          Download CSV
                        </Button>
                      </Space>
                    </div>
                    <SignalChart
                      priceSeries={response.price_series ?? response.equity_curve}
                      signals={response.signals ?? []}
                      showPrice={showPriceLine}
                      showBuys={showBuySignals}
                      showSells={showSellSignals}
                      onReady={(instance) => {
                        signalChartRef.current = instance;
                      }}
                    />
                  </Card>

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
      <Modal
        open={signalsInfoVisible}
        onCancel={() => setSignalsInfoVisible(false)}
        footer={null}
        width={720}
        title="Signal Annotations"
      >
        <Paragraph>
          A blue line shows the average price of the securities in the filtered universe. A green triangle marks a day where the enabled indicators all agreed to open a position (a <em>buy signal</em>). A red diamond marks the automated exit for that position, generated after the specified hold days or when the stop-loss / take-profit thresholds were reached.
        </Paragraph>
        <Paragraph>
          Buy and sell markers always appear in pairs. If you hide either layer with the toggles above, the chart keeps its time axis so you can focus on the remaining information.
        </Paragraph>
      </Modal>

      <footer className="app-footer">
        <p>By Wendi OUYANG – Chinese University of Hong Kong, Shenzhen</p>
        <p>Contact: vernonouyang@gmail.com</p>
      </footer>
    </ConfigProvider>
  );
};

export default App;
