import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Trade } from "../types";

interface Props {
  trades: Trade[];
}

const TradesTable = ({ trades }: Props) => {
  const columns: ColumnsType<Trade> = [
    { title: "Symbol", dataIndex: "symbol", key: "symbol", sorter: (a, b) => (a.symbol || "").localeCompare(b.symbol || "") },
    { title: "Enter Date", dataIndex: "enter_date", key: "enter_date", sorter: (a, b) => a.enter_date.localeCompare(b.enter_date) },
    { title: "Exit Date", dataIndex: "exit_date", key: "exit_date", sorter: (a, b) => a.exit_date.localeCompare(b.exit_date) },
    { title: "Enter Price", dataIndex: "enter_price", key: "enter_price", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.enter_price - b.enter_price },
    { title: "Exit Price", dataIndex: "exit_price", key: "exit_price", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.exit_price - b.exit_price },
    { title: "PnL", dataIndex: "pnl", key: "pnl", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.pnl - b.pnl },
    { title: "Return", dataIndex: "ret", key: "ret", render: (v: number) => `${(v * 100).toFixed(2)}%`, sorter: (a, b) => a.ret - b.ret },
  ];

  return (
    <Table
      size="small"
      rowKey={(record) => `${record.enter_date}-${record.symbol}`}
      columns={columns}
      dataSource={trades}
      pagination={{ pageSize: 20, showSizeChanger: false }}
      scroll={{ y: 420 }}
    />
  );
};

export default TradesTable;
