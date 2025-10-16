import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { ECharts } from "echarts";
import { Checkbox, Empty } from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import { HistogramPayload } from "../types";
import { formatNumber, formatPercent } from "../utils/format";

interface Props {
  data?: HistogramPayload | null;
  loading?: boolean;
  onReady?: (instance: ECharts) => void;
  height?: number;
  compact?: boolean;
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

  const filteredBins: HistogramBin[] = [];
  const filteredCounts: number[] = [];
  trimmedBins.forEach((bin, index) => {
    const count = trimmedCounts[index];
    if (count > 0) {
      filteredBins.push(bin);
      filteredCounts.push(count);
    }
  });

  if (!filteredBins.length) {
    return { bins: trimmedBins, counts: trimmedCounts };
  }

  return { bins: filteredBins, counts: filteredCounts };
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

const HistogramChart = ({ data, loading, onReady, height = 360, compact = false }: Props) => {
  const [selectedHorizons, setSelectedHorizons] = useState<number[]>([]);

  const seriesMap = useMemo(() => {
    if (!data?.series?.length) return new Map<number, number[]>();
    return new Map(data.series.map((item) => [item.horizon, item.returns]));
  }, [data?.series]);

  const horizons = useMemo(() => {
    const unique = new Set<number>();
    data?.series?.forEach((item) => unique.add(item.horizon));
    return Array.from(unique).sort((a, b) => a - b);
  }, [data?.series]);

  useEffect(() => {
    if (horizons.length) {
      setSelectedHorizons(horizons);
    } else {
      setSelectedHorizons([]);
    }
  }, [horizons]);

  const activeHorizons = useMemo(() => {
    return selectedHorizons.length ? selectedHorizons : horizons;
  }, [selectedHorizons, horizons]);

  const selectedValues = useMemo(() => {
    if (!activeHorizons.length) return [];
    const combined: number[] = [];
    activeHorizons.forEach((horizon) => {
      const values = seriesMap.get(horizon);
      if (values && values.length) {
        combined.push(...values);
      }
    });
    return combined;
  }, [activeHorizons, seriesMap]);

  const binWidth = data?.bin_width ?? 0.01;
  const histogram = useMemo(() => buildHistogram(selectedValues, binWidth), [selectedValues, binWidth]);
  const stats = useMemo(() => computeStats(selectedValues), [selectedValues]);

  const option = useMemo(() => {
    if (!histogram.bins.length || !histogram.counts.length) {
      return null;
    }

    const binCount = histogram.bins.length;
    const labelFontSize = (() => {
      if (binCount <= 4) return compact ? 12 : 14;
      if (binCount <= 6) return compact ? 11 : 13;
      if (binCount <= 10) return compact ? 10 : 12;
      if (binCount <= 16) return compact ? 9 : 11;
      if (binCount <= 22) return compact ? 8 : 10;
      return compact ? 7 : 9;
    })();
    const axisLabelMargin = Math.max(compact ? 8 : 10, Math.round(labelFontSize * 1.15));
    const axisLabelLineHeight = Math.round(labelFontSize * 1.3);
    const gridBottom = Math.max(compact ? 30 : 38, axisLabelMargin + axisLabelLineHeight + 6);
    const gridTop = compact ? 28 : 40;
    const axisNameGap = axisLabelMargin + Math.round(labelFontSize * 0.65);

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
        data: histogram.bins.map((bin) => {
          const start = formatNumber(bin.start * 100, 1);
          const end = formatNumber(bin.end * 100, 1);
          return `${start} - ${end}`;
        }),
        axisLabel: {
          interval: 0,
          rotate: 0,
          fontSize: labelFontSize,
          margin: axisLabelMargin,
          lineHeight: axisLabelLineHeight,
          formatter: (_value: string, index: number) => {
            const count = histogram.counts[index];
            const bin = histogram.bins[index];
            if (!count || !bin) {
              return "";
            }
            const start = formatNumber(bin.start * 100, 1);
            const end = formatNumber(bin.end * 100, 1);
            return `${start}\n-\n${end}`;
          },
        },
        axisTick: {
          alignWithLabel: true,
        },
        name: "%",
        nameLocation: "end",
        nameGap: axisNameGap,
        nameTextStyle: {
          fontSize: labelFontSize,
          fontWeight: 600,
          color: "#475569",
          padding: [0, 0, Math.max(0, axisLabelMargin - Math.round(labelFontSize * 0.9)), 6],
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
          barMaxWidth: compact ? 22 : 28,
          data: histogram.counts,
          label: {
            show: true,
            position: "top",
            formatter: ({ value }: { value: number }) =>
              typeof value === "number" && value > 0 ? formatNumber(value, 0) : "",
            fontSize: compact ? 10 : 11,
          },
          itemStyle: {
            color: "#4c6ef5",
            opacity: 0.82,
          },
        },
      ],
      grid: {
        left: compact ? 40 : 48,
        right: compact ? 16 : 24,
        bottom: gridBottom,
        top: gridTop,
        containLabel: true,
      },
    };
  }, [histogram, compact]);

  const handleToggleHorizon = (horizon: number, event: CheckboxChangeEvent) => {
    const checked = event.target.checked;
    setSelectedHorizons((prev) => {
      const base = prev.length ? prev : horizons;
      if (checked) {
        const set = new Set(base);
        set.add(horizon);
        return Array.from(set).sort((a, b) => a - b);
      }
      const next = base.filter((value) => value !== horizon);
      if (!next.length) {
        return horizons;
      }
      return next;
    });
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
        <span className="histogram-explorer__label">Holding periods</span>
        <div className="histogram-explorer__choices">
          {horizons.map((horizon) => {
            const isSelected = activeHorizons.includes(horizon);
            return (
              <Checkbox
                key={horizon}
                className="histogram-explorer__choice"
                checked={isSelected}
                onChange={(event) => handleToggleHorizon(horizon, event)}
              >
                {horizon}d
              </Checkbox>
            );
          })}
        </div>
      </div>
      {option ? (
        <ReactECharts option={option} style={{ height, width: "100%" }} onChartReady={onReady} />
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
