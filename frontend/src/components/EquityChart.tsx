import React, { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { Spin, Empty } from "antd";
import { TimeSeries } from "../types";
import { formatCurrency } from "../utils/format";
import dayjs from "dayjs";

interface Props {
  data?: TimeSeries | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
  compact?: boolean;
  height?: number | string;
}

const EquityChart = ({ data, loading, onReady, compact = false, height }: Props) => {

  if (loading) {
    return <Spin />;
  }
  if (!data || data.dates.length === 0) {
    return <Empty description="No equity data" />;
  }

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900;
  const axisFont = Math.max(12, Math.min(viewportWidth, viewportHeight) * 0.011);
  const axisMargin = axisFont * 0.8;
  const gridPadding = axisFont * 3;
  const sliderHeight = Math.max(24, axisFont * 2.4);
  const handleSize = Math.max(10, axisFont * 0.9);

  const seriesData = useMemo(
    () => data.dates.map((date, idx) => [date, data.values[idx]] as [string, number]),
    [data.dates, data.values]
  );

  const option = {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: number) => formatCurrency(value, 0),
    },
    toolbox: { feature: { saveAsImage: {} } },
    dataZoom: compact
      ? [
          {
            type: "inside",
            filterMode: "weakFilter",
            zoomOnMouseWheel: false,
            moveOnMouseWheel: true,
            moveOnMouseMove: true,
          },
        ]
      : [
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
            height: sliderHeight,
            fillerColor: "rgba(76, 110, 245, 0.18)",
            borderColor: "rgba(76, 110, 245, 0.3)",
            handleSize: handleSize,
            handleStyle: { color: "#4c6ef5" },
            moveHandleSize: handleSize * 0.75,
          },
        ],
    xAxis: {
      type: "time",
      axisLabel: {
        formatter: (() => {
          let lastLabel: string | null = null;
          return (value: number) => {
            const parsed = dayjs(value);
            if (!parsed.isValid()) return "";
            const quarter = Math.floor(parsed.month() / 3) + 1;
            const year = parsed.year();
            const label = `Q${quarter} ${year}`;
            if (label === lastLabel) {
              return "";
            }
            lastLabel = label;
            return label;
          };
        })(),
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        margin: axisMargin,
        fontSize: axisFont,
      },
      axisTick: {
        show: false,
      },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        formatter: (value: number) => formatCurrency(value, 0),
        fontSize: axisFont,
        margin: axisMargin,
      },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    grid: {
      top: gridPadding,
      left: gridPadding * 1.2,
      right: gridPadding * 0.6,
      bottom: compact ? gridPadding : gridPadding * 1.4,
    },
    series: [
      {
        type: "line",
        name: "Equity",
        showSymbol: false,
        smooth: true,
        lineStyle: { width: compact ? 1.5 : Math.max(2, axisFont * 0.12) },
        data: seriesData,
      },
    ],
  };

  const handleReady = (instance: ECharts) => {
    onReady?.(instance);
  };

  const chartHeight = height ?? "40vh";

  return <ReactECharts option={option} style={{ height: chartHeight }} onChartReady={handleReady} />;
};

export default EquityChart;
