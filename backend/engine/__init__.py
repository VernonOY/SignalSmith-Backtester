"""Core backtesting engine primitives."""

from .fees import FeeModel
from .execution import TradeBuilderConfig, ExecutionResult, build_trades_from_picks
from .pnl import build_equity_curve, compute_drawdown, warn_if_returns_constant
from .metrics import compute_performance_metrics

__all__ = [
    "FeeModel",
    "TradeBuilderConfig",
    "ExecutionResult",
    "build_trades_from_picks",
    "build_equity_curve",
    "compute_drawdown",
    "warn_if_returns_constant",
    "compute_performance_metrics",
]
