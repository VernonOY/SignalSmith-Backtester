import React, { useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { Spin, Empty } from "antd";
import { TimeSeries } from "../types";
import { formatDateYYMMDD, formatPercent } from "../utils/format";

interface Props {
  data?: TimeSeries | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
}

const DrawdownChart = ({ data, loading, onReady }: Props) => {
  const chartInstanceRef = useRef<ECharts | null>(null);

  if (loading) {
    return <Spin />;
  }
  if (!data || data.dates.length === 0) {
    return <Empty description="No drawdown data" />;
  }
  const option = {
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => formatPercent(v, 2),
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
        showDetail: false,
        height: 26,
        fillerColor: "rgba(255, 99, 132, 0.18)",
        borderColor: "rgba(255, 99, 132, 0.35)",
        handleSize: 14,
        handleStyle: { color: "#ff4d4f" },
        moveHandleSize: 10,
      },
    ],
    xAxis: {
      type: "category",
      data: data.dates,
      axisLabel: {
        formatter: (value: string) => formatDateYYMMDD(value),
        hideOverlap: true,
      },
      splitLine: { show: true, lineStyle: { color: "#ffe4e6" } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) => formatPercent(value, 0),
      },
      splitLine: { show: true, lineStyle: { color: "#ffe4e6" } },
    },
    series: [
      {
        type: "line",
        areaStyle: { color: "rgba(255, 77, 79, 0.2)" },
        lineStyle: { color: "#ff4d4f", width: 2 },
        showSymbol: false,
        data: data.values,
      },
    ],
    grid: {
      top: 40,
      left: 72,
      right: 28,
      bottom: 64,
    },
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
    const total = Math.max(data.dates.length, 1);
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
      <ReactECharts option={option} style={{ height: 320 }} onChartReady={handleReady} />
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

export default DrawdownChart;
