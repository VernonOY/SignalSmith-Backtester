import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";

interface IndicatorRow {
  horizon: string;
  mean?: number;
  median?: number;
  std?: number;
  skew?: number;
  kurt?: number;
}

interface Props {
  stats?: Record<string, Record<string, number>>;
}

const IndicatorStatsTable = ({ stats }: Props) => {
  if (!stats || !Object.keys(stats).length) {
    return null;
  }

  const rows: IndicatorRow[] = Object.entries(stats).map(([horizon, values]) => {
    const label = horizon.startsWith("fwd_ret_") ? horizon.replace("fwd_ret_", "") : horizon;
    return {
      horizon: label,
      ...values,
    };
  });

  const columns: ColumnsType<IndicatorRow> = [
    { title: "Horizon", dataIndex: "horizon", key: "horizon" },
    {
      title: "Mean",
      dataIndex: "mean",
      key: "mean",
      render: (value?: number) => (value !== undefined ? `${(value * 100).toFixed(2)}%` : "-"),
    },
    {
      title: "Median",
      dataIndex: "median",
      key: "median",
      render: (value?: number) => (value !== undefined ? `${(value * 100).toFixed(2)}%` : "-"),
    },
    {
      title: "Std",
      dataIndex: "std",
      key: "std",
      render: (value?: number) => (value !== undefined ? `${(value * 100).toFixed(2)}%` : "-"),
    },
    {
      title: "Skew",
      dataIndex: "skew",
      key: "skew",
      render: (value?: number) => (value !== undefined ? value.toFixed(2) : "-"),
    },
    {
      title: "Kurt",
      dataIndex: "kurt",
      key: "kurt",
      render: (value?: number) => (value !== undefined ? value.toFixed(2) : "-"),
    },
  ];

  return (
    <Table
      size="small"
      rowKey={(record) => record.horizon}
      columns={columns}
      dataSource={rows}
      pagination={false}
    />
  );
};

export default IndicatorStatsTable;
