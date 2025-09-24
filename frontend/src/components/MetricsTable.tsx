import { Empty } from "antd";
import { Metrics } from "../types";

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
  if (!entries.length) {
    return <Empty description="No metrics" />;
  }
  return (
    <div className="metrics-grid">
      {entries.map(([key, value]) => {
        let display: string | number = value;
        if (typeof value === "number") {
          if (key === "ending_equity") {
            display = value.toFixed(2);
          } else if (key === "sharpe") {
            display = value.toFixed(2);
          } else if (percentKeys.has(key)) {
            display = `${(value * 100).toFixed(2)}%`;
          } else {
            display = value.toFixed(4);
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
