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
  height?: number;
}

const EquityChart = ({ data, loading, onReady, compact = false, height }: Props) => {

  if (loading) {
    return <Spin />;
  }
  if (!data || data.dates.length === 0) {
    return <Empty description="No equity data" />;
  }

  const seriesData = useMemo(
    () => data.dates.map((date, idx) => [date, data.values[idx]] as [string, number]),
    [data.dates, data.values]
  );

  const firstDate = useMemo(() => dayjs(data.dates[0]), [data.dates]);
  const lastDate = useMemo(() => dayjs(data.dates[data.dates.length - 1]), [data.dates]);

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
            height: 22,
            fillerColor: "rgba(76, 110, 245, 0.18)",
            borderColor: "rgba(76, 110, 245, 0.3)",
            handleSize: 12,
            handleStyle: { color: "#4c6ef5" },
            moveHandleSize: 9,
          },
        ],
    xAxis: {
      type: "time",
      axisLabel: {
        formatter: (value: number) => {
          const parsed = dayjs(value);
          if (!parsed.isValid()) return "";
          const month = parsed.month();
          const isQuarterStart = parsed.date() === 1 && month % 3 === 0;
          const isFirst = parsed.isSame(firstDate, "day");
          const isLast = parsed.isSame(lastDate, "day");
          if (!isQuarterStart && !isFirst && !isLast) {
            return "";
          }
          const quarter = Math.floor(month / 3) + 1;
          return `Q${quarter} ${parsed.year()}`;
        },
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        margin: compact ? 8 : 14,
        fontSize: compact ? 10 : 11,
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
        fontSize: compact ? 10 : 11,
        margin: compact ? 6 : 8,
      },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    grid: {
      top: compact ? 24 : 32,
      left: compact ? 56 : 68,
      right: compact ? 18 : 24,
      bottom: compact ? 36 : 52,
    },
    series: [
      {
        type: "line",
        name: "Equity",
        showSymbol: false,
        smooth: true,
        lineStyle: { width: compact ? 1.5 : 2 },
        data: seriesData,
      },
    ],
  };

  const handleReady = (instance: ECharts) => {
    onReady?.(instance);
  };

  const chartHeight = height ?? (compact ? 220 : 288);

  return <ReactECharts option={option} style={{ height: chartHeight }} onChartReady={handleReady} />;
};

export default EquityChart;
