import { Empty } from "antd";
import { Metrics } from "../types";
import { formatCurrency, formatNumber, formatPercent } from "../utils/format";

interface Props {
  metrics: Metrics;
}

const percentKeys = new Set([
  "avg_daily_return",
  "volatility_daily",
  "annualized_return",
  "annualized_vol",
  "max_drawdown",
]);

const MetricsTable = ({ metrics }: Props) => {
  const entries = Object.entries(metrics ?? {});
  const displayEntries = entries.filter(([key]) => key !== "ending_equity");
  if (!displayEntries.length) {
    return <Empty description="No metrics" />;
  }
  return (
    <div className="metrics-grid">
      {displayEntries.map(([key, value]) => {
        let display: string | number = value;
        if (typeof value === "number") {
          if (key === "sharpe") {
            display = value.toFixed(2);
          } else if (percentKeys.has(key)) {
            display = formatPercent(value, 2);
          } else if (key.endsWith("_usd")) {
            display = formatCurrency(value, 0);
          } else {
            display = formatNumber(value, 4);
          }
        }
        return (
          <div key={key} className="metrics-item">
            <h4>{key.replace(/_/g, " ")}</h4>
            <span>{display}</span>
          </div>
        );
      })}
    </div>
  );
};

export default MetricsTable;
