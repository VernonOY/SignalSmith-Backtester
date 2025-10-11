import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { Checkbox, Empty, Space, Tag } from "antd";
import type { CheckboxValueType } from "antd/es/checkbox/Group";
import { HistogramPayload } from "../types";
import { formatNumber, formatPercent } from "../utils/format";

interface Props {
  data?: HistogramPayload | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
  height?: number;
  compact?: boolean;
}

interface RangeOption {
  key: string;
  label: string;
  horizons: number[];
}

interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

interface HistogramResult {
  bins: HistogramBin[];
  counts: number[];
}

interface HistogramStats {
  mean: number;
  median: number;
  std: number;
  skew: number;
  kurt: number;
  sampleSize: number;
}

const buildRangeOptions = (horizons: number[]): RangeOption[] => {
  if (!horizons.length) return [];
  const sorted = [...new Set(horizons)].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1];
  const ranges: RangeOption[] = [];
  const step = 3;
  let start = sorted[0];
  while (start <= max) {
    let end = Math.min(start + step - 1, max);
    if (max - end === 1) {
      end = max;
    }
    const horizonsInRange = sorted.filter((value) => value >= start && value <= end);
    ranges.push({
      key: `${start}-${end}`,
      label: `${start}-${end}d`,
      horizons: horizonsInRange,
    });
    start = end + 1;
  }
  return ranges;
};

const buildHistogram = (values: number[], binWidth: number): HistogramResult => {
  if (!values.length) {
    return { bins: [], counts: [] };
  }
  const width = binWidth > 0 ? binWidth : 0.01;
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return { bins: [], counts: [] };
  }
  const lowerBound = Math.min(minValue, 0);
  const upperBound = Math.max(maxValue, 0);
  let negSteps = lowerBound < 0 ? Math.ceil(Math.abs(lowerBound) / width) : 0;
  let posSteps = upperBound > 0 ? Math.ceil(upperBound / width) : 0;
  if (negSteps === 0) negSteps = 1;
  if (posSteps === 0) posSteps = 1;
  const totalBins = negSteps + posSteps;
  const start = -negSteps * width;
  const bins: HistogramBin[] = [];
  const counts = new Array(totalBins).fill(0);
  for (let i = 0; i < totalBins; i += 1) {
    const binStart = Number((start + i * width).toFixed(6));
    const binEnd = Number((binStart + width).toFixed(6));
    bins.push({ start: binStart, end: binEnd, count: 0 });
  }

  values.forEach((value) => {
    if (!Number.isFinite(value)) return;
    let idx = Math.floor((value - start) / width);
    if (idx < 0) idx = 0;
    if (idx >= totalBins) idx = totalBins - 1;
    counts[idx] += 1;
  });

  for (let i = 0; i < counts.length; i += 1) {
    bins[i].count = counts[i];
  }

  const zeroIndex = bins.findIndex((bin) => bin.start <= 0 && bin.end > 0);
  let first = 0;
  let last = bins.length - 1;
  while (first < last && counts[first] === 0 && (zeroIndex === -1 || first < zeroIndex)) {
    first += 1;
  }
  while (last > first && counts[last] === 0 && (zeroIndex === -1 || last > zeroIndex)) {
    last -= 1;
  }

  const trimmedBins = bins.slice(first, last + 1);
  const trimmedCounts = counts.slice(first, last + 1);
  return { bins: trimmedBins, counts: trimmedCounts };
};

const computeStats = (values: number[]): HistogramStats | null => {
  if (!values.length) {
    return null;
  }
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const mean = sum / n;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  values.forEach((val) => {
    const diff = val - mean;
    m2 += diff ** 2;
    m3 += diff ** 3;
    m4 += diff ** 4;
  });
  const variance = m2 / n;
  const std = Math.sqrt(Math.max(variance, 0));
  let skew = 0;
  if (n > 2 && std > 0) {
    skew = (n * m3) / ((n - 1) * (n - 2) * std ** 3);
  }
  let kurt = 0;
  if (n > 3 && std > 0) {
    kurt =
      ((n * (n + 1) * m4) / ((n - 1) * (n - 2) * (n - 3) * std ** 4)) -
      ((3 * (n - 1) ** 2) / ((n - 2) * (n - 3)));
  }
  return { mean, median, std, skew, kurt, sampleSize: n };
};

const HistogramChart = ({ data, loading, onReady, height = 320, compact = false }: Props) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const seriesMap = useMemo(() => {
    if (!data?.series?.length) return new Map<number, number[]>();
    return new Map(data.series.map((item) => [item.horizon, item.returns]));
  }, [data?.series]);

  const horizons = useMemo(() => {
    return data?.series?.map((item) => item.horizon).sort((a, b) => a - b) ?? [];
  }, [data?.series]);

  const rangeOptions = useMemo(() => buildRangeOptions(horizons), [horizons]);

  useEffect(() => {
    if (rangeOptions.length) {
      setSelectedKeys(rangeOptions.map((option) => option.key));
    } else {
      setSelectedKeys([]);
    }
  }, [rangeOptions]);

  const selectedHorizons = useMemo(() => {
    const options = rangeOptions.filter((option) => selectedKeys.includes(option.key));
    if (!options.length) {
      return rangeOptions.flatMap((option) => option.horizons);
    }
    const unique = new Set<number>();
    options.forEach((option) => option.horizons.forEach((value) => unique.add(value)));
    return Array.from(unique).sort((a, b) => a - b);
  }, [rangeOptions, selectedKeys]);

  const selectedValues = useMemo(() => {
    if (!selectedHorizons.length) return [];
    const combined: number[] = [];
    selectedHorizons.forEach((horizon) => {
      const values = seriesMap.get(horizon);
      if (values && values.length) {
        combined.push(...values);
      }
    });
    return combined;
  }, [selectedHorizons, seriesMap]);

  const binWidth = data?.bin_width ?? 0.01;
  const histogram = useMemo(() => buildHistogram(selectedValues, binWidth), [selectedValues, binWidth]);
  const stats = useMemo(() => computeStats(selectedValues), [selectedValues]);

  const categories = histogram.bins.map((bin) => {
    const start = formatPercent(bin.start, 1);
    const end = formatPercent(bin.end, 1);
    return `${start} – ${end}`;
  });

  const option = useMemo(() => {
    if (!histogram.bins.length || !histogram.counts.length) {
      return null;
    }
    return {
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const bin = histogram.bins[params.dataIndex];
          const start = formatPercent(bin.start, 2);
          const end = formatPercent(bin.end, 2);
          return `${start} to ${end}<br/>Count: ${params.value}`;
        },
      },
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: {
          interval: 0,
          rotate: 90,
          fontSize: compact ? 10 : 11,
          margin: compact ? 12 : 16,
          align: "left",
        },
      },
      yAxis: {
        type: "value",
        name: "Trades",
        nameLocation: "middle",
        nameGap: compact ? 28 : 34,
        axisLabel: {
          fontSize: compact ? 10 : 11,
        },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: compact ? 18 : 24,
          data: histogram.counts,
          itemStyle: {
            color: "#4c6ef5",
            opacity: 0.82,
          },
        },
      ],
      grid: {
        left: compact ? 48 : 56,
        right: compact ? 24 : 32,
        bottom: compact ? 56 : 68,
        top: compact ? 32 : 44,
        containLabel: true,
      },
    };
  }, [histogram, categories, compact]);

  const handleRangeChange = (values: CheckboxValueType[]) => {
    setSelectedKeys(values.map(String));
  };

  if (loading) {
    return <div style={{ textAlign: "center" }}>Loading…</div>;
  }

  if (!data || !data.series.length) {
    return <Empty description="No histogram data" />;
  }

  const summaryEntries = stats
    ? [
        { label: "Mean", value: formatPercent(stats.mean, 2) },
        { label: "Median", value: formatPercent(stats.median, 2) },
        { label: "Std Dev", value: formatPercent(stats.std, 2) },
        { label: "Skew", value: formatNumber(stats.skew, 2) },
        { label: "Kurtosis", value: formatNumber(stats.kurt, 2) },
        { label: "Sample", value: formatNumber(stats.sampleSize, 0) },
      ]
    : [];

  return (
    <div className="histogram-explorer">
      <div className="histogram-explorer__controls">
        <span className="histogram-explorer__label">Holding period ranges</span>
        <Checkbox.Group
          options={rangeOptions.map((option) => ({ label: option.label, value: option.key }))}
          value={selectedKeys.length ? selectedKeys : rangeOptions.map((option) => option.key)}
          onChange={handleRangeChange}
        />
        {selectedHorizons.length > 0 && (
          <Space size={4} wrap className="histogram-explorer__tags">
            {selectedHorizons.map((horizon) => (
              <Tag key={horizon} color="blue">
                {horizon}d
              </Tag>
            ))}
          </Space>
        )}
      </div>
      {option ? (
        <ReactECharts option={option} style={{ height }} onChartReady={onReady} />
      ) : (
        <Empty description="No returns for selected ranges" />
      )}
      {summaryEntries.length > 0 && (
        <div className="histogram-summary run-summary__grid">
          {summaryEntries.map((item) => (
            <div key={item.label} className="run-summary__item">
              <span className="run-summary__label">{item.label}</span>
              <span className="run-summary__value">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HistogramChart;
