import React, { useRef } from "react";
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { Spin, Empty } from "antd";
import { TimeSeries } from "../types";

interface Props {
  data?: TimeSeries | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
}

const EquityChart = ({ data, loading, onReady }: Props) => {
  const chartInstanceRef = useRef<ECharts | null>(null);

  if (loading) {
    return <Spin />;
  }
  if (!data || data.dates.length === 0) {
    return <Empty description="No equity data" />;
  }

  const option = {
    tooltip: { trigger: "axis" },
    toolbox: { feature: { saveAsImage: {} } },
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
        fillerColor: "rgba(76, 110, 245, 0.18)",
        borderColor: "rgba(76, 110, 245, 0.3)",
        handleSize: 14,
        handleStyle: { color: "#4c6ef5" },
        moveHandleSize: 10,
      },
    ],
    xAxis: { type: "category", data: data.dates },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "line",
        name: "Equity",
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2 },
        data: data.values,
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

export default EquityChart;
