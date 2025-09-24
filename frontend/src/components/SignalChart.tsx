import React, { useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { Empty } from "antd";
import { Signal, TimeSeries } from "../types";

interface Props {
  priceSeries?: TimeSeries | null;
  signals: Signal[];
  onReady?: (instance: ECharts) => void;
}

const SignalChart = ({ priceSeries, signals, onReady }: Props) => {
  const chartInstanceRef = useRef<ECharts | null>(null);
  if (!priceSeries || priceSeries.dates.length === 0) {
    return <Empty description="No price data" />;
  }
  const buys = signals.filter((s) => s.type !== "sell" && s.price !== undefined);
  const sells = signals.filter((s) => s.type === "sell" && s.price !== undefined);
  const buyData = buys.map((s) => [s.date, s.price, s.symbol]);
  const sellData = sells.map((s) => [s.date, s.price, s.symbol]);
  const option = {
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        if (params.seriesType === "scatter") {
          const [date, price, symbol] = params.value;
          return `${date}<br/>Signal @ ${price}<br/>${symbol ?? ""}`;
        }
        return `${params.name}<br/>Price: ${params.data}`;
      },
    },
    dataZoom: [
      {
        type: "inside",
        filterMode: "weakFilter",
        zoomOnMouseWheel: false,
        moveOnMouseWheel: true,
        moveOnMouseMove: true,
      },
      {
        type: "slider",
        height: 26,
        fillerColor: "rgba(76, 110, 245, 0.2)",
        borderColor: "rgba(76, 110, 245, 0.3)",
        handleSize: 14,
        handleStyle: { color: "#4c6ef5" },
        moveHandleSize: 10,
      },
    ],
    xAxis: { type: "category", data: priceSeries.dates },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "line",
        name: "Price",
        showSymbol: false,
        data: priceSeries.values,
        lineStyle: { width: 1.8, color: "#1677ff" },
      },
      {
        type: "scatter",
        name: "Buys",
        data: buyData,
        symbol: "triangle",
        symbolSize: 8,
        itemStyle: { color: "#16a34a", opacity: 0.6 },
        emphasis: { scale: 1.2, focus: "series" },
        animation: false,
      },
      {
        type: "scatter",
        name: "Sells",
        data: sellData,
        symbol: "diamond",
        symbolSize: 8,
        itemStyle: { color: "#ff4d4f", opacity: 0.7 },
        emphasis: { scale: 1.2, focus: "series" },
        animation: false,
      },
    ],
  };

  const handleReady = (instance: ECharts) => {
    chartInstanceRef.current = instance;
    onReady?.(instance);
  };

  const shiftWindow = (direction: -1 | 1) => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    const option = chart.getOption() as any;
    const dz = option.dataZoom?.[0];
    if (!dz) return;
    const total = Math.max(priceSeries.dates.length, 1);
    const percentStep = 100 / total;
    let start = typeof dz.start === "number" ? dz.start : 0;
    let end = typeof dz.end === "number" ? dz.end : 100;
    let windowSize = end - start;
    if (windowSize <= 0) {
      windowSize = Math.max(percentStep, 5 * percentStep);
    }
    const newStart = Math.max(0, Math.min(start + direction * percentStep, 100 - windowSize));
    const newEnd = Math.min(100, newStart + windowSize);
    chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, start: newStart, end: newEnd });
  };

  return (
    <div className="chart-wrapper">
      <button
        type="button"
        className="chart-nudge chart-nudge--left"
        onClick={() => shiftWindow(-1)}
        aria-label="Shift time window left"
      >
        ‹
      </button>
      <ReactECharts option={option} style={{ height: 360 }} onChartReady={handleReady} />
      <button
        type="button"
        className="chart-nudge chart-nudge--right"
        onClick={() => shiftWindow(1)}
        aria-label="Shift time window right"
      >
        ›
      </button>
    </div>
  );
};

export default SignalChart;
