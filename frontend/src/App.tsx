import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, ConfigProvider, Select, Space, Typography, message, theme } from "antd";
import html2canvas from "html2canvas";
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels";
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
  const [selectedHorizons, setSelectedHorizons] = useState<number[]>([]);
  const [selectedEquityHorizon, setSelectedEquityHorizon] = useState<number | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [dynamicScale, setDynamicScale] = useState(1);
  const panelRef = useRef<ImperativePanelHandle>(null);
  const isSnappingRef = useRef(false);
  const dragStartSizeRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dashboard-compact", compactMode ? "1" : "0");
    if (compactMode) {
      root.setAttribute("data-compact", "true");
    } else {
      root.removeAttribute("data-compact");
    }
  }, [compactMode]);

  // 动态计算缩放比例以适应窗口大小
  useEffect(() => {
    const calculateScale = () => {
      // 固定的 dashboard 尺寸
      const dashboardWidth = 1800;
      const dashboardHeight = 1020;

      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // 计算宽度和高度的缩放比例，取较小值以确保完整显示
      const scaleX = windowWidth / dashboardWidth;
      const scaleY = windowHeight / dashboardHeight;
      const scale = Math.min(scaleX, scaleY);

      setDynamicScale(scale);

      // 更新CSS变量
      const root = document.documentElement;
      root.style.setProperty("--layout-scale", scale.toString());
    };

    calculateScale();

    // 延迟重新计算以确保DOM完全渲染
    const timer = setTimeout(() => {
      calculateScale();
    }, 100);

    window.addEventListener("resize", calculateScale);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", calculateScale);
    };
  }, []);

  const fitToSinglePage = useCallback((enable = true) => {
    setCompactMode(enable);
  }, []);

  useEffect(() => {
    (window as any).fitToSinglePage = fitToSinglePage;
    return () => {
      delete (window as any).fitToSinglePage;
    };
  }, [fitToSinglePage]);

  // 磁吸效果：当接近20%时强制吸附，制造阻力感
  const handlePanelLayout = useCallback((sizes: number[]) => {
    const currentSize = sizes[0];
    const snapPoint = 20;
    const snapZone = 2; // 在18%-22%范围内触发吸附
    const breakFreeDistance = 2.5; // 需要拖动超过这个距离才能脱离

    const distanceFromSnap = Math.abs(currentSize - snapPoint);

    // 如果在吸附区域内
    if (distanceFromSnap < snapZone) {
      // 如果还没开始吸附
      if (!isSnappingRef.current) {
        // 记录开始拖动时的位置
        dragStartSizeRef.current = currentSize;
        isSnappingRef.current = true;
      }

      // 检查是否用力拖动足够远
      const dragDistance = dragStartSizeRef.current !== null
        ? Math.abs(currentSize - dragStartSizeRef.current)
        : 0;

      // 如果拖动距离不够，强制回到20%
      if (dragDistance < breakFreeDistance && panelRef.current) {
        panelRef.current.resize(snapPoint);
        return;
      }
    }

    // 超出吸附区域或拖动足够远，允许自由移动
    if (distanceFromSnap >= snapZone) {
      isSnappingRef.current = false;
      dragStartSizeRef.current = null;
    }
  }, []);

  const handleSubmit = async (payload: BacktestRequest, _rawValues?: any) => {
    try {
      setLoading(true);
      const { data } = await api.post<BacktestResponse>("/run_backtest", payload);
      console.log("Backtest response:", data);
      setResponse(data);
      setLastRunConfig(payload);
      message.success("Backtest complete");
    } catch (error: any) {
      console.error("Backtest error:", error);
      const detail = error?.response?.data?.detail || error.message;
      message.error(detail ?? "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExportScreenshot = useCallback(async () => {
    try {
      const element = document.querySelector('.dashboard');
      if (!element) {
        message.error("Dashboard not found");
        return;
      }

      message.info("Generating screenshot...");

      await new Promise((resolve) => setTimeout(resolve, 300));

      const canvas = await html2canvas(element as HTMLElement, {
        backgroundColor: "#eef1ff",
        scale: 2,
        useCORS: true,
        logging: false,
        width: element.scrollWidth,
        height: element.scrollHeight,
        ignoreElements: (element) => {
          // 忽略可能有问题的元素
          return element.classList?.contains('ant-message') || false;
        },
        onclone: (clonedDoc) => {
          // 在克隆的文档中移除可能导致问题的 CSS
          const styles = clonedDoc.querySelectorAll('style');
          styles.forEach((style) => {
            if (style.textContent) {
              // 移除 color() 函数
              style.textContent = style.textContent.replace(/color\([^)]+\)/g, '#000000');
            }
          });
        },
      });

      canvas.toBlob((blob) => {
        if (!blob) {
          message.error("Failed to create image");
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `signalsmith-dashboard-${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        message.success("Screenshot exported successfully");
      }, "image/png");
    } catch (error) {
      console.error("Screenshot failed:", error);
      message.error(`Failed to export screenshot: ${error}`);
    }
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
      setSelectedHorizons([]);
      setSelectedEquityHorizon(null);
      return;
    }
    if (!availableHorizons.length) {
      setSelectedHorizons([]);
      setSelectedEquityHorizon(null);
      return;
    }
    // Default to all available horizons for histogram
    setSelectedHorizons(availableHorizons);
    // Default to first horizon for equity curve
    setSelectedEquityHorizon(availableHorizons[0]);
  }, [response, availableHorizons]);

  const activeHorizons = useMemo(() => {
    if (!availableHorizons.length) {
      return [];
    }
    if (selectedHorizons.length > 0) {
      return selectedHorizons.filter(h => availableHorizons.includes(h));
    }
    return availableHorizons;
  }, [availableHorizons, selectedHorizons]);

  // For equity curve, use separate selected horizon
  const activeHorizonResult = useMemo(() => {
    if (!horizonResults || selectedEquityHorizon == null) {
      return null;
    }
    const key = String(selectedEquityHorizon);
    return horizonResults[key] ?? null;
  }, [horizonResults, selectedEquityHorizon]);

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

  const sectorsSummary = useMemo(() => {
    if (!lastRunConfig?.filters?.sectors || !lastRunConfig.filters.sectors.length) {
      return { label: "Sectors", value: "None" };
    }
    return { label: "Sectors", value: lastRunConfig.filters.sectors.join(" · ") };
  }, [lastRunConfig]);

  const settingsSummary = useMemo(() => {
    if (!lastRunConfig) {
      return [] as InfoTag[];
    }
    // Exclude Sectors from universeSummary
    const universeSummaryWithoutSectors = universeSummary.filter(item => item.label !== "Sectors");
    return [...runSettingsSummary, ...universeSummaryWithoutSectors, ...signalSummary];
  }, [lastRunConfig, runSettingsSummary, universeSummary, signalSummary]);

  const hasIndicatorStats = Boolean(response?.indicator_statistics);

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
        </header>

        <div className="dashboard__body">
          <Card className="combined-card" size="small">
            <PanelGroup direction="horizontal" onLayout={handlePanelLayout}>
              <Panel
                ref={panelRef}
                defaultSize={20}
                minSize={15}
                maxSize={40}
                order={1}
              >
                <div className="dashboard__sidebar-content">
                  <SidebarForm
                    loading={loading}
                    onSubmit={handleSubmit}
                    compact={compactMode}
                  />
                </div>
              </Panel>

              <PanelResizeHandle className="resize-handle" />

              <Panel
                defaultSize={80}
                minSize={60}
                maxSize={85}
                order={2}
              >
                {!response ? (
                  <div className="dashboard__placeholder">
                    <div className="intro-content">
                      <Title level={4}>Configure &amp; Run</Title>
                      <Text type="secondary">
                        Adjust parameters on the left and run the engine to populate the dashboard.
                      </Text>
                    </div>
                  </div>
                ) : (
                  <div className="dashboard__results-content">
                    <Card className="result-card mega-card" size="small">
                    {response.histogram && (
                      <section className="mega-card__section mega-card__section--histogram">
                        <div className="card-header">
                          <Title level={4}>Return Distribution</Title>
                          {availableHorizons.length > 1 && (
                            <div className="card-header__actions">
                              <span className="histogram-explorer__label">Holding periods</span>
                              <Space size={6}>
                                {availableHorizons.map((horizon) => (
                                  <Button
                                    key={horizon}
                                    size="small"
                                    type={activeHorizons.includes(horizon) ? "primary" : "default"}
                                    onClick={() => {
                                      setSelectedHorizons(prev => {
                                        if (prev.includes(horizon)) {
                                          // If deselecting and it's the last one, keep it selected
                                          if (prev.length === 1) return prev;
                                          return prev.filter(h => h !== horizon);
                                        } else {
                                          return [...prev, horizon].sort((a, b) => a - b);
                                        }
                                      });
                                    }}
                                  >
                                    {horizon}d
                                  </Button>
                                ))}
                              </Space>
                            </div>
                          )}
                        </div>
                        <HistogramChart
                          data={response.histogram}
                          loading={loading}
                          compact
                          height={compactMode ? 380 : 460}
                          selectedHorizons={activeHorizons}
                        />
                      </section>
                    )}

                    <div className="mega-card__split">
                      <section className="mega-card__column mega-card__column--details">
                        {hasIndicatorStats && (
                          <div className="mega-card__section">
                            <div className="card-header">
                              <Title level={4}>Indicator Statistics</Title>
                            </div>
                            <IndicatorStatsTable stats={response!.indicator_statistics!} compact />
                          </div>
                        )}

                        {settingsSummary.length > 0 && (
                          <div className="mega-card__section">
                            <div className="run-summary">
                              <div className="run-summary__section run-summary__section--settings">
                                <div className="run-summary__title">Settings</div>
                                <div className="run-summary__sectors">
                                  <span className="run-summary__label">{sectorsSummary.label}</span>
                                  <span className="run-summary__value">{sectorsSummary.value}</span>
                                </div>
                                <div className="run-summary__grid run-summary__grid--dense">
                                  {settingsSummary.map((item, index) => (
                                    <div className="run-summary__item" key={`settings-${item.label}-${index}`}>
                                      <span className="run-summary__label">{item.label}</span>
                                      <span className="run-summary__value">{item.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </section>

                      <section className="mega-card__column mega-card__column--equity">
                        <div className="mega-card__section">
                          <div className="card-header">
                            <Title level={4}>Equity Curve</Title>
                            {availableHorizons.length > 1 && (
                              <div className="card-header__actions">
                                <span className="histogram-explorer__label">Holding period</span>
                                <Select
                                  value={selectedEquityHorizon}
                                  onChange={(value) => setSelectedEquityHorizon(value)}
                                  options={horizonOptions}
                                  style={{ width: 80 }}
                                  size="small"
                                />
                              </div>
                            )}
                          </div>
                          <EquityChart
                            data={equitySeries}
                            loading={loading}
                            compact
                            height={compactMode ? 280 : 340}
                          />
                        </div>

                        {equityMetrics.length > 0 && (
                          <div className="mega-card__section">
                            <div className="run-summary__grid run-summary__grid--metrics">
                              {equityMetrics.map((metric) => (
                                <div className="run-summary__item" key={metric.key}>
                                  <span className="run-summary__label">{metric.label}</span>
                                  <span className="run-summary__value">{metric.value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  </Card>
                  </div>
                )}
              </Panel>
            </PanelGroup>
          </Card>
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
