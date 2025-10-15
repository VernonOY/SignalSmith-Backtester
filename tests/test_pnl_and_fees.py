import math

import pandas as pd
import pytest

from backend.engine import FeeModel, TradeBuilderConfig, build_trades_from_picks


def _make_pick(symbol: str, date: str, price: float, simple_return: float, hold_days: int) -> dict:
    return {
        "symbol": symbol,
        "date": pd.Timestamp(date),
        "adj_close": price,
        f"fwd_ret_{hold_days}d": math.log1p(simple_return),
    }


def test_trade_financials_match_hand_calculation():
    hold_days = 5
    fee_model = FeeModel(5.0)  # 0.05% per side
    picks = pd.DataFrame(
        [
            _make_pick("AAA", "2023-01-02", 100.0, 0.05, hold_days),
            _make_pick("BBB", "2023-01-12", 80.0, 0.08, hold_days),
            _make_pick("CCC", "2023-01-24", 120.0, -0.03, hold_days),
        ]
    )

    config = TradeBuilderConfig(
        hold_days=hold_days,
        fee_model=fee_model,
        initial_capital=10_000.0,
        compound=False,
    )
    result = build_trades_from_picks(picks, config)
    trades = result.trades

    assert len(trades) == 3
    assert trades["quantity"].notna().all()
    assert trades["net_return"].nunique() > 1
    assert result.ledger["cash"].min() >= -1e-6

    for row in trades.itertuples():
        enter_price = row.enter_price
        simple_return = {
            "AAA": 0.05,
            "BBB": 0.08,
            "CCC": -0.03,
        }[row.symbol]
        quantity = config.initial_capital / (enter_price * (1.0 + fee_model.rate))
        expected_notional = enter_price * quantity
        buy_fee = expected_notional * fee_model.rate
        exit_price = enter_price * (1.0 + simple_return)
        sell_notional = exit_price * quantity
        sell_fee = sell_notional * fee_model.rate
        gross_pnl = sell_notional - expected_notional
        net_pnl = gross_pnl - (buy_fee + sell_fee)
        expected_return = net_pnl / expected_notional

        assert row.notional == pytest.approx(expected_notional, rel=1e-6)
        assert row.buy_fee == pytest.approx(buy_fee, rel=1e-6)
        assert row.sell_fee == pytest.approx(sell_fee, rel=1e-6)
        assert row.gross_pnl == pytest.approx(gross_pnl, rel=1e-6)
        assert row.net_pnl == pytest.approx(net_pnl, rel=1e-6)
        assert row.net_return == pytest.approx(expected_return, rel=1e-6)
