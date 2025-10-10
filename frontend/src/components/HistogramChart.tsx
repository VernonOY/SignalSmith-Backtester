import React from "react";
import ReactECharts from "echarts-for-react";
import { Empty } from "antd";
import type { ECharts } from "echarts";
import { HistogramPayload } from "../types";

interface Props {
  data?: HistogramPayload | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
  height?: number;
  compact?: boolean;
}

const HistogramChart = ({ data, loading, onReady, height = 256, compact = false }: Props) => {
  if (loading) {
    return <div style={{ textAlign: "center" }}>Loading…</div>;
  }
  if (!data || !data.buckets.length) {
    return <Empty description="No histogram data" />;
  }

  const categories = data.buckets.map((bucket) => {
    const start = (bucket.bin_start * 100).toFixed(2);
    const end = (bucket.bin_end * 100).toFixed(2);
    return `${start}% – ${end}%`;
  });

  const option = {
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        const bucket = data.buckets[params.dataIndex];
        const start = (bucket.bin_start * 100).toFixed(2);
        const end = (bucket.bin_end * 100).toFixed(2);
        return `${start}% to ${end}%<br/>Count: ${bucket.count}`;
      },
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: {
        rotate: 22,
        interval: 0,
        margin: compact ? 6 : 10,
        fontSize: compact ? 10 : 11,
        formatter: (value: string) => value.replace(/\s+/g, ""),
      },
    },
    yAxis: {
      type: "value",
      name: "Trades",
      nameLocation: "middle",
      nameGap: compact ? 32 : 40,
      axisLabel: {
        fontSize: compact ? 10 : 11,
        margin: compact ? 4 : 6,
      },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: compact ? 18 : 24,
        data: data.buckets.map((bucket) => bucket.count),
        itemStyle: {
          color: "#4c6ef5",
          opacity: 0.8,
        },
      },
    ],
    grid: {
      left: compact ? 48 : 56,
      right: compact ? 20 : 28,
      bottom: compact ? 52 : 64,
      top: compact ? 28 : 40,
      containLabel: true,
    },
  };

  return <ReactECharts option={option} style={{ height }} onChartReady={onReady} />;
};

export default HistogramChart;
