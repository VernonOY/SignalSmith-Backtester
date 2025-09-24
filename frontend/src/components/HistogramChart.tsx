import React from "react";
import ReactECharts from "echarts-for-react";
import { Empty, Statistic } from "antd";
import type { ECharts } from "echarts";
import { HistogramPayload } from "../types";

interface Props {
  data?: HistogramPayload | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
  height?: number;
}

const HistogramChart = ({ data, loading, onReady, height = 400 }: Props) => {
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
        rotate: 40,
        interval: 0,
      },
    },
    yAxis: {
      type: "value",
      name: "Frequency",
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 24,
        data: data.buckets.map((bucket) => bucket.count),
        itemStyle: {
          color: "#4c6ef5",
          opacity: 0.8,
        },
      },
    ],
    grid: {
      left: 70,
      right: 28,
      bottom: 130,
      top: 24,
      containLabel: true,
    },
  };

  const statEntries = Object.entries(data.stats || {});
  const percentStats = new Set(["mean", "median", "std"]);

  return (
    <div>
      <ReactECharts option={option} style={{ height }} onChartReady={onReady} />
      {statEntries.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 16 }}>
          {statEntries.map(([label, value]) => {
            const isPercent = percentStats.has(label);
            const formatted = isPercent ? (value * 100).toFixed(2) : value.toFixed(2);
            return (
              <Statistic
                key={label}
                title={label.toUpperCase()}
                value={formatted}
                suffix={isPercent ? "%" : undefined}
              />
            );
          })}
          <Statistic title="Samples" value={data.sample_size} />
        </div>
      )}
    </div>
  );
};

export default HistogramChart;
