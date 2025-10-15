"""Serialisers for report payloads exposed to the frontend."""

from __future__ import annotations

from typing import Any, Dict, List

import pandas as pd


def serialise_trades(trades: pd.DataFrame) -> List[Dict[str, Any]]:
    """Return trade dictionaries suitable for JSON responses."""

    if trades is None or trades.empty:
        return []

    payload: List[Dict[str, Any]] = []
    for row in trades.itertuples():
        payload.append(
            {
                "enter_date": row.enter_date.strftime("%Y-%m-%d"),
                "exit_date": row.exit_date.strftime("%Y-%m-%d"),
                "enter_price": float(row.enter_price),
                "exit_price": float(row.exit_price),
                "pnl": float(row.net_pnl),
                "ret": float(row.net_return),
                "symbol": getattr(row, "symbol", None),
                "gross_pnl": float(row.gross_pnl),
                "fees": float(row.fees),
                "side": getattr(row, "side", "long"),
                "quantity": float(row.quantity),
                "notional": float(row.notional),
                "buy_fee": float(row.buy_fee),
                "sell_fee": float(row.sell_fee),
            }
        )
    return payload
