"""Performance metric calculations for backtests."""

from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd


def compute_performance_metrics(
    equity: pd.Series,
    drawdown: pd.Series,
    annualisation_factor: int = 252,
) -> Dict[str, float]:
    metrics: Dict[str, float] = {}
    if equity is None or equity.empty:
        return metrics

    equity = equity.sort_index()
    returns = equity.pct_change().dropna()
    if not returns.empty:
        avg_daily = returns.mean()
        vol_daily = returns.std(ddof=0)
        metrics["avg_daily_return"] = float(avg_daily)
        metrics["volatility_daily"] = float(vol_daily)
        metrics["annualized_return"] = float(((1.0 + avg_daily) ** annualisation_factor) - 1.0)
        metrics["annualized_vol"] = float(vol_daily * np.sqrt(annualisation_factor))
        if vol_daily > 0:
            metrics["sharpe"] = float((avg_daily / vol_daily) * np.sqrt(annualisation_factor))
    if drawdown is not None and not drawdown.empty:
        metrics["max_drawdown"] = float(drawdown.min())
    metrics["ending_equity"] = float(equity.iloc[-1])
    return metrics
