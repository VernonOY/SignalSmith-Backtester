import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

interface IndicatorRow {
  key: string;
  stat: string;
  [horizon: string]: string;
}

interface Props {
  stats?: Record<string, Record<string, number>>;
  compact?: boolean;
}

const IndicatorStatsTable = ({ stats, compact = false }: Props) => {
  if (!stats || !Object.keys(stats).length) {
    return null;
  }

  const horizonEntries = Object.entries(stats).map(([horizon, values]) => {
    const label = horizon.startsWith("fwd_ret_") ? horizon.replace("fwd_ret_", "") : horizon;
    return {
      key: horizon,
      label,
      values,
    };
  });

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
      scroll={{ x: "max-content" }}
    />
  );
};

export default IndicatorStatsTable;
