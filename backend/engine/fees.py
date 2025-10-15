"""Fee model helpers for the backtesting engine."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeeModel:
    """Represents a simple basis point fee model.

    The fee is assumed to be charged on each side of the trade.  A ``fee_bps``
    of ``5`` therefore corresponds to ``0.05%`` on both the buy and sell.
    """

    fee_bps: float = 0.0

    @property
    def rate(self) -> float:
        """Return the decimal fee rate for a single side of the trade."""

        return max(0.0, float(self.fee_bps)) / 10_000.0

    def fee_for_notional(self, notional: float) -> float:
        """Compute the fee charged for a given traded notional."""

        if notional <= 0 or notional != notional:  # NaN guard
            return 0.0
        return notional * self.rate

    def round_trip_fees(self, buy_notional: float, sell_notional: float) -> float:
        """Compute the total fees for a round trip trade."""

        return self.fee_for_notional(buy_notional) + self.fee_for_notional(sell_notional)
