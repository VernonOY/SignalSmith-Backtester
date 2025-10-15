import math

import pandas as pd

from backend.engine import (
    FeeModel,
    TradeBuilderConfig,
    build_equity_curve,
    build_trades_from_picks,
    compute_drawdown,
    compute_performance_metrics,
    warn_if_returns_constant,
)


def _sample_picks(hold_days: int) -> pd.DataFrame:
    base_date = pd.Timestamp("2023-02-01")
    records = []
    simple_returns = [0.015, -0.02, -0.005, 0.025, -0.03, 0.01]
    prices = [55, 60, 58, 62, 65, 59]
    for i in range(12):
        symbol = f"SYM{i % 6}"
        date = base_date + pd.tseries.offsets.BDay(i)
        price = prices[i % len(prices)] + (i % 3)
        simple = simple_returns[i % len(simple_returns)]
        if i % 4 == 0:
            simple = -0.02  # introduce losses for drawdown realism
        records.append(
            {
                "symbol": symbol,
                "date": date,
                "adj_close": price,
                f"fwd_ret_{hold_days}d": math.log1p(simple),
            }
        )
    return pd.DataFrame(records)


def test_smoke_backtest_behaviour():
    hold_days = 3
    picks = _sample_picks(hold_days)
    fee_model = FeeModel(2.0)
    config = TradeBuilderConfig(
        hold_days=hold_days,
        fee_model=fee_model,
        initial_capital=50_000.0,
        compound=False,
    )
    result = build_trades_from_picks(picks, config)
    trades = result.trades

    assert 10 <= len(trades) <= 20
    assert trades["net_return"].nunique() > 1
    assert result.ledger["cash"].min() >= -1e-6

    equity = build_equity_curve(trades, initial_capital=config.initial_capital)
    assert not equity.empty
    diffs = equity.diff().dropna()
    assert (diffs > 0).any(), "Equity curve should have upward moves"

    drawdown = compute_drawdown(equity)
    metrics = compute_performance_metrics(equity, drawdown)
    assert "annualized_vol" in metrics and metrics["annualized_vol"] < 0.2
    assert "sharpe" in metrics and -3 <= metrics["sharpe"] <= 3

    ratio = warn_if_returns_constant(trades)
    assert ratio is not None and ratio >= 0.5

    total_fees = trades["fees"].sum()
    gross_profit = trades["gross_pnl"].sum()
    assert abs(total_fees) < 0.1 * (abs(gross_profit) + 1e-6)
