# Backtest Metrics and Fee Conventions

## Fee Model

- Fees are specified in **basis points per side**. A `fee_bps` value of `5` corresponds to `0.05%` of the traded notional on both the buy and sell legs.
- The per-side fee is `fee = traded_notional * fee_bps / 10_000`.
- Round-trip fees are the sum of the buy and sell fees. For example, trading $5,000 with `fee_bps = 5` incurs `$5,000 * 0.0005 = $2.50` on the buy and `$5,250 * 0.0005 = $2.625` on the sell.

## Trade Sizing and Notional

- Trade quantity is computed from the allocated capital slice and the entry price including fees: `quantity = capital_allocated / (entry_price * (1 + fee_rate))`.
- The traded notional is always `entry_price * quantity`. Quantities are validated to ensure they are positive and finite; invalid trades are rejected.
- Available cash is reduced by the total cost (notional plus fees) when a position is opened and increased by the net proceeds (notional minus fees) when it is closed.

## Profit and Return

- Gross PnL for long positions: `(exit_price - entry_price) * quantity`.
- Net PnL subtracts round-trip fees: `net_pnl = gross_pnl - (buy_fee + sell_fee)`.
- Simple return is measured relative to the entry notional: `net_return = net_pnl / abs(entry_price * quantity)`.
- The engine warns if fewer than 50% of trade returns are distinct within a batch to catch suspiciously constant return series.

## Equity Curves and Compounding

- Equity is updated when trades close: `equity_t = initial_capital + cumulative_sum(net_pnl_t)`.
- Drawdown is `equity / equity.cummax() - 1`.
- A fixed-allocation, non-compounding mode is available for diagnostics (used in smoke tests). Profits can be reinvested by enabling compounding.

## Annualised Metrics

- Daily returns are computed from the equity curve.
- Annualised return uses `(1 + mean_daily_return)^252 - 1`.
- Annualised volatility is `std_daily_return * sqrt(252)`.
- Sharpe ratio is `(mean_daily_return / std_daily_return) * sqrt(252)` when volatility is non-zero.

## Reporting Fields

Each trade exported to the frontend includes:

- `side`, `quantity`, `notional`
- `gross_pnl`, `fees`, `net_pnl`
- `buy_fee`, `sell_fee`
- `pnl` (alias of `net_pnl`) and `ret` (net return)

These values flow through to the trades table so that gross profit, fees, and net profit can be visually reconciled.
