import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Trade } from "../types";

interface Props {
  trades: Trade[];
}

const TradesTable = ({ trades }: Props) => {
  const columns: ColumnsType<Trade> = [
    { title: "Symbol", dataIndex: "symbol", key: "symbol", sorter: (a, b) => (a.symbol || "").localeCompare(b.symbol || "") },
    { title: "Side", dataIndex: "side", key: "side", filters: [{ text: "Long", value: "long" }, { text: "Short", value: "short" }], onFilter: (value, record) => record.side === value },
    { title: "Enter Date", dataIndex: "enter_date", key: "enter_date", sorter: (a, b) => a.enter_date.localeCompare(b.enter_date) },
    { title: "Exit Date", dataIndex: "exit_date", key: "exit_date", sorter: (a, b) => a.exit_date.localeCompare(b.exit_date) },
    { title: "Quantity", dataIndex: "quantity", key: "quantity", render: (v: number) => v.toFixed(4), sorter: (a, b) => a.quantity - b.quantity },
    { title: "Notional", dataIndex: "notional", key: "notional", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.notional - b.notional },
    { title: "Enter Price", dataIndex: "enter_price", key: "enter_price", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.enter_price - b.enter_price },
    { title: "Exit Price", dataIndex: "exit_price", key: "exit_price", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.exit_price - b.exit_price },
    { title: "Gross PnL", dataIndex: "gross_pnl", key: "gross_pnl", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.gross_pnl - b.gross_pnl },
    { title: "Fees", dataIndex: "fees", key: "fees", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.fees - b.fees },
    { title: "Net PnL", dataIndex: "pnl", key: "pnl", render: (v: number) => v.toFixed(2), sorter: (a, b) => a.pnl - b.pnl },
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
