import { Empty } from "antd";
import { Metrics } from "../types";

interface Props {
  metrics: Metrics;
}

const MetricsTable = ({ metrics }: Props) => {
  const entries = Object.entries(metrics ?? {});
  if (!entries.length) {
    return <Empty description="No metrics" />;
  }
  return (
    <div className="metrics-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="metrics-item">
          <h4>{key.replace(/_/g, " ")}</h4>
          <span>{typeof value === "number" ? value.toFixed(4) : value}</span>
        </div>
      ))}
    </div>
  );
};

export default MetricsTable;
