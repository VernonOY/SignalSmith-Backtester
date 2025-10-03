"""Trade execution and sizing utilities."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from pandas.tseries import offsets

from .fees import FeeModel

logger = logging.getLogger(__name__)


def _debug_logging_enabled() -> bool:
    value = os.getenv("BACKTEST_DEBUG_TRADES", "")
    return value.lower() in {"1", "true", "yes", "on"}


if _debug_logging_enabled():  # pragma: no cover - configuration branch
    logger.setLevel(logging.DEBUG)


@dataclass(frozen=True)
class TradeBuilderConfig:
    hold_days: int
    fee_model: FeeModel
    initial_capital: float
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    compound: bool = True


@dataclass
class ExecutionResult:
    trades: pd.DataFrame
    ledger: pd.DataFrame


def _prepare_candidates(
    picks: pd.DataFrame,
    hold_days: int,
    stop_loss_pct: Optional[float],
    take_profit_pct: Optional[float],
) -> pd.DataFrame:
    if picks is None or picks.empty:
        return pd.DataFrame(
            columns=[
                "enter_date",
                "exit_date",
                "symbol",
                "enter_price",
                "exit_price",
                "gross_return",
            ]
        )

    hold_days = max(1, int(hold_days))
    ret_col = f"fwd_ret_{hold_days}d"
    if ret_col not in picks.columns:
        return pd.DataFrame(
            columns=[
                "enter_date",
                "exit_date",
                "symbol",
                "enter_price",
                "exit_price",
                "gross_return",
            ]
        )

    records: List[Dict[str, object]] = []
    stop_loss = abs(stop_loss_pct) if stop_loss_pct is not None else None
    take_profit = take_profit_pct if take_profit_pct is not None else None

    for row in picks.itertuples():
        enter_price = float(getattr(row, "adj_close", np.nan))
        enter_date = getattr(row, "date", None)
        raw_ret = getattr(row, ret_col, np.nan)
        symbol = getattr(row, "symbol", None)
        if pd.isna(raw_ret) or pd.isna(enter_price) or enter_price <= 0:
            continue
        if not isinstance(enter_date, pd.Timestamp):
            enter_date = pd.to_datetime(enter_date)
        if pd.isna(enter_date):
            continue

        gross_simple = float(np.expm1(raw_ret))
        if stop_loss is not None:
            gross_simple = max(gross_simple, -stop_loss)
        if take_profit is not None:
            gross_simple = min(gross_simple, take_profit)

        exit_price = enter_price * (1.0 + gross_simple)
        if exit_price <= 0:
            continue
        exit_date = (enter_date + offsets.BDay(hold_days)).normalize()

        records.append(
            {
                "enter_date": enter_date.normalize(),
                "exit_date": exit_date,
                "symbol": symbol,
                "enter_price": enter_price,
                "exit_price": float(exit_price),
                "gross_return": float(gross_simple),
            }
        )

    candidates = pd.DataFrame(records)
    if candidates.empty:
        return candidates

    candidates.sort_values(by=["enter_date", "exit_date", "symbol"], inplace=True)
    candidates.reset_index(drop=True, inplace=True)
    return candidates


def _max_active_positions(trades: pd.DataFrame) -> int:
    if trades.empty:
        return 0
    events: List[Tuple[pd.Timestamp, int]] = []
    for row in trades.itertuples():
        events.append((row.enter_date, 1))
        events.append((row.exit_date, -1))
    events.sort(key=lambda item: (item[0], item[1]))
    active = 0
    max_active = 0
    for _, delta in events:
        active += delta
        max_active = max(max_active, active)
    return max_active


def _current_equity(cash: float, open_positions: Dict[int, Dict[str, float]]) -> float:
    float_positions = sum(pos["market_value"] for pos in open_positions.values())
    return cash + float_positions


def build_trades_from_picks(picks: pd.DataFrame, config: TradeBuilderConfig) -> ExecutionResult:
    """Convert indicator picks into sized trades respecting capital constraints."""

    candidates = _prepare_candidates(
        picks,
        hold_days=config.hold_days,
        stop_loss_pct=config.stop_loss_pct,
        take_profit_pct=config.take_profit_pct,
    )
    empty_cols = [
        "enter_date",
        "exit_date",
        "symbol",
        "side",
        "enter_price",
        "exit_price",
        "quantity",
        "buy_notional",
        "sell_notional",
        "buy_fee",
        "sell_fee",
        "gross_pnl",
        "net_pnl",
        "net_return",
        "gross_return",
        "capital_allocated",
        "fees",
        "notional",
    ]
    ledger_cols = ["ts", "event", "symbol", "side", "quantity", "price", "notional", "fee", "pnl", "cash", "equity"]
    if candidates.empty:
        return ExecutionResult(pd.DataFrame(columns=empty_cols), pd.DataFrame(columns=ledger_cols))

    fee_model = config.fee_model
    initial_capital = max(1.0, float(config.initial_capital))
    max_active = max(1, _max_active_positions(candidates))
    open_positions: Dict[int, Dict[str, float]] = {}
    ledger: List[Dict[str, float]] = []
    realised: List[Dict[str, float]] = []

    cash = float(initial_capital)

    events: List[Tuple[pd.Timestamp, str, int]] = []
    for idx, row in candidates.iterrows():
        events.append((row["enter_date"], "entry", idx))
        events.append((row["exit_date"], "exit", idx))
    events.sort(key=lambda item: (item[0], 0 if item[1] == "exit" else 1))

    for ts, event_type, idx in events:
        row = candidates.loc[idx]
        symbol = row.get("symbol")
        if event_type == "entry":
            available_slots = max_active - len(open_positions)
            if available_slots <= 0:
                logger.debug("Skipping entry due to zero available slots", extra={"symbol": symbol})
                continue
            if config.compound:
                allocation_base = cash / available_slots
            else:
                allocation_base = initial_capital / max_active
            allocation = min(allocation_base, cash)
            if allocation <= 0:
                logger.debug("Insufficient cash for entry", extra={"symbol": symbol})
                continue
            denominator = row["enter_price"] * (1.0 + fee_model.rate)
            quantity = allocation / denominator if denominator > 0 else 0.0
            if quantity <= 0 or not np.isfinite(quantity):
                logger.error("Computed invalid quantity", extra={"symbol": symbol, "allocation": allocation})
                continue
            buy_notional = row["enter_price"] * quantity
            buy_fee = fee_model.fee_for_notional(buy_notional)
            total_cost = buy_notional + buy_fee
            if total_cost - cash > 1e-6:
                logger.error(
                    "Trade would exceed available cash", extra={"symbol": symbol, "cost": total_cost, "cash": cash}
                )
                continue
            cash -= total_cost
            open_positions[idx] = {
                "quantity": quantity,
                "buy_notional": buy_notional,
                "buy_fee": buy_fee,
                "enter_price": row["enter_price"],
                "capital_allocated": allocation,
                "market_value": buy_notional,
            }
            equity = _current_equity(cash, open_positions)
            logger.debug(
                "EXECUTE BUY",
                extra={
                    "ts": ts,
                    "symbol": symbol,
                    "side": "buy",
                    "qty": quantity,
                    "price": row["enter_price"],
                    "notional": buy_notional,
                    "fee": buy_fee,
                    "pnl": 0.0,
                    "cash": cash,
                    "equity": equity,
                },
            )
            ledger.append(
                {
                    "ts": ts,
                    "event": "buy",
                    "symbol": symbol,
                    "side": "buy",
                    "quantity": quantity,
                    "price": row["enter_price"],
                    "notional": buy_notional,
                    "fee": buy_fee,
                    "pnl": 0.0,
                    "cash": cash,
                    "equity": equity,
                }
            )
        else:
            position = open_positions.pop(idx, None)
            if position is None:
                continue
            quantity = position["quantity"]
            buy_notional = position["buy_notional"]
            buy_fee = position["buy_fee"]
            sell_notional = row["exit_price"] * quantity
            sell_fee = fee_model.fee_for_notional(sell_notional)
            cash += sell_notional - sell_fee
            gross_pnl = sell_notional - buy_notional
            total_fees = buy_fee + sell_fee
            net_pnl = gross_pnl - total_fees
            net_return = net_pnl / abs(buy_notional) if buy_notional != 0 else 0.0
            equity = _current_equity(cash, open_positions)
            logger.debug(
                "EXECUTE SELL",
                extra={
                    "ts": ts,
                    "symbol": symbol,
                    "side": "sell",
                    "qty": quantity,
                    "price": row["exit_price"],
                    "notional": sell_notional,
                    "fee": sell_fee,
                    "pnl": net_pnl,
                    "cash": cash,
                    "equity": equity,
                },
            )
            ledger.append(
                {
                    "ts": ts,
                    "event": "sell",
                    "symbol": symbol,
                    "side": "sell",
                    "quantity": quantity,
                    "price": row["exit_price"],
                    "notional": sell_notional,
                    "fee": sell_fee,
                    "pnl": net_pnl,
                    "cash": cash,
                    "equity": equity,
                }
            )
            realised.append(
                {
                    "enter_date": row["enter_date"],
                    "exit_date": row["exit_date"],
                    "symbol": symbol,
                    "side": "long",
                    "enter_price": row["enter_price"],
                    "exit_price": row["exit_price"],
                    "quantity": quantity,
                    "buy_notional": buy_notional,
                    "sell_notional": sell_notional,
                    "buy_fee": buy_fee,
                    "sell_fee": sell_fee,
                    "gross_pnl": gross_pnl,
                    "net_pnl": net_pnl,
                    "gross_return": row["gross_return"],
                    "net_return": net_return,
                    "capital_allocated": position["capital_allocated"],
                    "fees": total_fees,
                    "notional": buy_notional,
                }
            )
    trades_df = pd.DataFrame(realised, columns=empty_cols)
    ledger_df = pd.DataFrame(ledger, columns=ledger_cols)
    return ExecutionResult(trades=trades_df, ledger=ledger_df)
