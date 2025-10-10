import { memo } from "react";

export interface KPIEntry {
  key: string;
  label: string;
  value: string;
}

interface Props {
  entries: KPIEntry[];
  compact?: boolean;
}

const KPIBar = ({ entries, compact = false }: Props) => {
  if (!entries.length) return null;
  return (
    <div className={`kpi-bar${compact ? " kpi-bar--compact" : ""}`} role="group" aria-label="Key performance metrics">
      {entries.map((entry) => (
        <div key={entry.key} className="kpi-bar__item">
          <span className="kpi-bar__label" title={entry.label}>
            {entry.label}
          </span>
          <span className="kpi-bar__value">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export default memo(KPIBar);
