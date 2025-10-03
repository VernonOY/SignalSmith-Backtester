"""PnL helpers for the backtesting engine."""

from __future__ import annotations

import logging
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)


def build_equity_curve(trades: pd.DataFrame, initial_capital: float, column: str = "net_pnl") -> pd.Series:
    """Build an equity curve from realised trade PnL."""

    if trades is None or trades.empty:
        return pd.Series(dtype=float)
    if column not in trades.columns:
        raise KeyError(f"Column '{column}' not found in trades DataFrame")
    pnl = trades.groupby("exit_date")[column].sum().sort_index()
    if pnl.empty:
        return pd.Series(dtype=float)
    equity = float(initial_capital) + pnl.cumsum()
    equity.index = pd.to_datetime(equity.index)
    equity.name = "equity"
    return equity


def compute_drawdown(equity: pd.Series) -> pd.Series:
    """Compute percentage drawdown from an equity curve."""

    if equity is None or equity.empty:
        return pd.Series(dtype=float)
    running_max = equity.cummax()
    drawdown = equity / running_max - 1.0
    drawdown.name = "drawdown"
    return drawdown


def warn_if_returns_constant(trades: pd.DataFrame, threshold: float = 0.5) -> Optional[float]:
    """Emit a warning if distinct returns fall below the configured ratio."""

    if trades is None or trades.empty or "net_return" not in trades.columns:
        return None
    distinct = trades["net_return"].round(8).nunique()
    ratio = distinct / float(len(trades)) if len(trades) else 0.0
    if ratio < threshold:
        logger.warning(
            "Trade returns show low variability", extra={"distinct_ratio": ratio, "trade_count": len(trades)}
        )
    return ratio
