import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

interface IndicatorRow {
  key: string;
  stat: string;
  [horizon: string]: string;
}

interface Props {
  stats?: Record<string, Record<string, number | null>>;
  compact?: boolean;
}

const IndicatorStatsTable = ({ stats, compact = false }: Props) => {
  if (!stats || !Object.keys(stats).length) {
    return null;
  }

  const numericHorizons = Object.keys(stats)
    .map((key) => {
      const match = key.match(/fwd_ret_(\d+)d/);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => value !== null);

  const combinedLabel = numericHorizons.length
    ? `All (${Math.min(...numericHorizons)}–${Math.max(...numericHorizons)}d)`
    : "All";

  const horizonEntries = Object.entries(stats)
    .map(([horizon, values]) => {
      const match = horizon.match(/fwd_ret_(\d+)d/);
      const order = match ? Number(match[1]) : horizon === "combined" ? -1 : Number.POSITIVE_INFINITY;
      const label = horizon === "combined" ? combinedLabel : match ? `${match[1]}d` : horizon;
      return {
        key: horizon,
        label,
        values,
        order,
      };
    })
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    })
    .map(({ key, label, values }) => ({ key, label, values }));

  const statConfigs = [
    {
      key: "mean",
      label: "Mean",
      format: (value?: number) => (value !== undefined ? `${(value * 100).toFixed(2)}%` : "—"),
    },
    {
      key: "median",
      label: "Median",
      format: (value?: number) => (value !== undefined ? `${(value * 100).toFixed(2)}%` : "—"),
    },
    {
      key: "std",
      label: "Std",
      format: (value?: number) => (value !== undefined ? `${(value * 100).toFixed(2)}%` : "—"),
    },
    {
      key: "skew",
      label: "Skew",
      format: (value?: number) => (value !== undefined ? value.toFixed(2) : "—"),
    },
    {
      key: "kurt",
      label: "Kurt",
      format: (value?: number) => (value !== undefined ? value.toFixed(2) : "—"),
    },
  ] as const;

  const rows: IndicatorRow[] = statConfigs.map((config) => {
    const row: IndicatorRow = {
      key: config.key,
      stat: config.label,
    };

    horizonEntries.forEach(({ label, values }) => {
      const rawValue = values[config.key as keyof typeof values];
      row[label] = config.format(typeof rawValue === "number" ? rawValue : undefined);
    });

    return row;
  });

  const columns: ColumnsType<IndicatorRow> = [
    {
      title: "Stat",
      dataIndex: "stat",
      key: "stat",
      width: 96,
      render: (value: string) => <span className="indicator-table__stat">{value}</span>,
    },
    ...horizonEntries.map(({ label, key }) => ({
      title: label,
      dataIndex: label,
      key: `horizon-${key}`,
      align: "right" as const,
      render: (value?: string) => value ?? "—",
    })),
  ];

  return (
    <Table
      size="small"
      rowKey={(record) => record.key}
      columns={columns}
      dataSource={rows}
      pagination={false}
      className={`indicator-table${compact ? " indicator-table--compact" : ""}`}
    />
  );
};

export default IndicatorStatsTable;
