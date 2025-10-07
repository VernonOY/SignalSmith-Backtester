"""
backtest_system.py
-------------------

This module implements a simplified quantitative back‑testing engine similar to
the Shiny dashboard your mentor shared.  It provides helper functions for
fetching daily price data via an API (for example Alpha Vantage), computing
several technical indicators, generating trading signals, calculating forward
returns and summary statistics, and producing histogram plots of those
returns.  The code is organised so that the data acquisition layer can be
swapped out if you use a different API or a local data source.  A small
demonstration at the bottom of the file shows how to wire everything up
together on some synthetic price data when run as a script.

The meeting summary described in your internship emphasised a few key
requirements:

* **Use publicly available daily OHLCV data**.  The function
  ``fetch_daily_data_alpha_vantage`` demonstrates how to call the Alpha Vantage
  API.  You can supply your own API key and call this function for each
  ticker you wish to back‑test.  Replace this function or add additional
  functions if you prefer a different provider.

* **Compute a variety of technical indicators** – RSI, ADX, Aroon, stochastic
  oscillator, MACD, OBV and exponential moving averages.  All these are
  implemented from first principles in pure NumPy/Pandas so no external
  packages are required.

* **Generate buy signals based on indicator thresholds**.  Each indicator
  function returns both the indicator values and a boolean array marking
  where a trade signal is generated.  You can combine multiple signals using
  ``combine_signals`` under different policies: ``'any'`` requires at least
  one indicator to fire, ``'all'`` requires all selected indicators to fire,
  and ``'atleast_k'`` requires at least ``k`` of them.

* **Calculate forward returns** for horizons from 1 to 10 days.  The
  ``compute_forward_returns`` function computes log returns shifted forward
  for each requested horizon.  These forward returns are then summarised by
  ``calculate_statistics`` (mean, median, standard deviation, skewness and
  kurtosis) and visualised with a histogram via Matplotlib.

The demonstration at the bottom of this file simulates a random walk for a
single ticker and runs a simple RSI based strategy to show how the pieces
fit together.  When you hook this module up to real data, replace the
``simulate_price_series`` call with actual prices fetched from an API.

Usage example (outside of synthetic demo):

>>> from backtest_system import (
...     get_sp500_tickers, fetch_daily_data_alpha_vantage,
...     calculate_rsi, calculate_adx, calculate_aroon,
...     combine_signals, compute_forward_returns, calculate_statistics,
... )
>>> tickers = get_sp500_tickers()
>>> api_key = "YOUR_ALPHA_VANTAGE_KEY"
>>> # Fetch data for one ticker
>>> df = fetch_daily_data_alpha_vantage("AAPL", api_key, start_date="2020-01-01", end_date="2024-12-31")
>>> # Compute indicators
>>> rsi, rsi_signal = calculate_rsi(df['adj_close'], n=14, oversold=30, overbought=70, rule='signal')
>>> adx, adx_signal = calculate_adx(df['high'], df['low'], df['close'], n=14, min_adx=20)
>>> # Combine signals: require both indicators to fire on the same day
>>> combined = combine_signals([rsi_signal, adx_signal], policy='all')
>>> # Compute forward returns for horizons 1–10 days
>>> fwd = compute_forward_returns(df['adj_close'], max_horizon=10)
>>> # Filter forward returns where combined signals are True
>>> fwd_selected = fwd[combined]
>>> # Summarise statistics
>>> stats = calculate_statistics(fwd_selected)
>>> print(stats)

When integrating into a web UI you can expose each of these parameters (lookback
windows, thresholds, combination policy, horizon, etc.) as form controls and
wire them into these functions.  The heavy lifting of fetching data,
computing indicators and statistics is handled here.
"""

from __future__ import annotations

import math
import datetime as dt
from dataclasses import dataclass, fields
from typing import List, Tuple, Optional, Dict, Sequence, Mapping, Any

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

try:
    import requests  # Requests may not be available in all environments
except ImportError:
    requests = None  # type: ignore


@dataclass
class IndicatorConfig:
    """Configuration for indicator usage when running multi-ticker backtests."""
    use_rsi: bool = False
    rsi_n: int = 14
    rsi_oversold: float = 30.0
    rsi_overbought: float = 70.0
    rsi_rule: str = "signal"

    use_adx: bool = False
    adx_n: int = 14
    adx_min: float = 20.0

    use_aroon: bool = False
    aroon_n: int = 25
    aroon_up: float = 70.0
    aroon_dn: float = 30.0

    use_stoch: bool = False
    stoch_k: int = 14
    stoch_d: int = 3
    stoch_rule: str = "signal"
    stoch_thresh: float = 20.0

    use_macd: bool = False
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    macd_rule: str = "signal"

    use_obv: bool = False
    obv_rule: str = "rise"

    use_ema: bool = False
    ema_short: int = 12
    ema_long: int = 26

    policy: str = "any"
    atleast_k: int = 2

    @classmethod
    def from_mapping(cls, mapping: Optional[Mapping[str, Any]] = None) -> "IndicatorConfig":
        if mapping is None:
            return cls()
        if isinstance(mapping, cls):
            return mapping
        data: Dict[str, Any] = {}
        for field in fields(cls):
            if mapping and field.name in mapping:
                data[field.name] = mapping[field.name]
        return cls(**data)

    def enabled(self) -> List[str]:
        names = []
        if self.use_rsi:
            names.append("RSI")
        if self.use_adx:
            names.append("ADX")
        if self.use_aroon:
            names.append("Aroon")
        if self.use_stoch:
            names.append("Stochastic")
        if self.use_macd:
            names.append("MACD")
        if self.use_obv:
            names.append("OBV")
        if self.use_ema:
            names.append("EMA")
        return names


def get_sp500_tickers() -> List[str]:
    """Return a hard‑coded list of S&P 500 tickers.

    Networking is disabled in this environment, so we cannot scrape the list
    from the internet.  Instead we embed a recent list of S&P 500 component
    symbols as of early 2025.  You can update this list manually if the
    composition of the index changes.
    """
    return [
        "AAPL", "MSFT", "AMZN", "NVDA", "META", "GOOGL", "GOOG", "BRK.B", "JPM", "JNJ",
        "V", "UNH", "XOM", "MA", "PG", "TSLA", "LLY", "HD", "MRK", "ABBV",
        "COST", "CVX", "ADBE", "AVGO", "KO", "PEP", "PFE", "BAC", "MCD", "CSCO",
        "ORCL", "DHR", "NKE", "DIS", "BMY", "WMT", "CRM", "ACN", "ABT", "TXN",
        "NFLX", "INTC", "CMCSA", "QCOM", "AMD", "TMUS", "NEE", "LOW", "VZ", "T",
        "LIN", "PM", "CAT", "HON", "AMGN", "GE", "UPS", "SBUX", "IBM", "RTX",
        "INTU", "SPGI", "BLK", "AXP", "LMT", "MDT", "SYK", "ISRG", "NOW", "BKNG",
        "CB", "BA", "PLD", "AMD", "DE", "GILD", "AMAT", "PYPL", "ADI", "ELV",
        "C", "SCHW", "GS", "COP", "CL", "SO", "MO", "TJX", "TGT", "CI",
        "MMC", "USB", "APD", "CVS", "DUK", "CME", "HUM", "ADP", "CSX", "PGR"
        # ... list truncated for brevity; add the remaining tickers as needed
    ]


def fetch_daily_data_alpha_vantage(
    symbol: str,
    api_key: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    output_size: str = "full",
) -> pd.DataFrame:
    """Fetch daily adjusted price data for a single symbol from Alpha Vantage.

    Parameters
    ----------
    symbol : str
        The ticker symbol to query.
    api_key : str
        Your Alpha Vantage API key.  You must register for a free API key at
        https://www.alphavantage.co/support/#api-key to use this function.
    start_date, end_date : str, optional
        ISO date strings (YYYY‑MM‑DD) to bound the data.  If not provided
        all available history is returned.
    output_size : {"compact", "full"}
        Alpha Vantage returns 100 data points for ``compact`` and up to 20 years
        for ``full``.

    Returns
    -------
    DataFrame with columns ``date``, ``open``, ``high``, ``low``, ``close``,
    ``adj_close`` and ``volume`` sorted by ascending date.

    Notes
    -----
    This function uses HTTP GET via the ``requests`` library.  In this
    environment network calls may be blocked, so this function may not work
    unless you run it locally.  It is provided here for completeness and to
    show you how to integrate an API into the back‑tester.  If you cannot
    access Alpha Vantage, consider using a locally stored CSV instead.
    """
    if requests is None:
        raise RuntimeError("The 'requests' library is not available in this environment.")
    url = "https://www.alphavantage.co/query"
    params = {
        "function": "TIME_SERIES_DAILY_ADJUSTED",
        "symbol": symbol,
        "outputsize": output_size,
        "apikey": api_key,
    }
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    ts_key = "Time Series (Daily)"
    if ts_key not in data:
        raise ValueError(f"Unexpected response from Alpha Vantage: {data}")
    records = []
    for date_str, values in data[ts_key].items():
        record_date = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
        if start_date and record_date < dt.date.fromisoformat(start_date):
            continue
        if end_date and record_date > dt.date.fromisoformat(end_date):
            continue
        records.append({
            "date": record_date,
            "open": float(values["1. open"]),
            "high": float(values["2. high"]),
            "low": float(values["3. low"]),
            "close": float(values["4. close"]),
            "adj_close": float(values["5. adjusted close"]),
            "volume": int(values["6. volume"]),
        })
    df = pd.DataFrame(records)
    df.sort_values("date", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def calculate_rsi(
    prices: Sequence[float],
    n: int = 14,
    oversold: float = 30.0,
    overbought: float = 70.0,
    rule: str = "signal",
) -> Tuple[pd.Series, pd.Series]:
    """Compute the Relative Strength Index (RSI) and generate a signal.

    Parameters
    ----------
    prices : sequence of float
        Adjusted closing prices.
    n : int
        Lookback period for the RSI calculation.
    oversold, overbought : float
        Thresholds used to generate signals.
    rule : {"signal", "oversold", "overbought"}
        Signal rule:
        - ``signal`` – buy when RSI crosses above the oversold threshold from below.
        - ``oversold`` – buy when RSI is below the oversold threshold.
        - ``overbought`` – buy when RSI is above the overbought threshold (this
          implements a contrarian strategy; you can invert this behaviour if
          desired).

    Returns
    -------
    rsi : Series
        The RSI values.
    signal : Series of bool
        True where the chosen rule triggers a buy signal, otherwise False.
    """
    oversold = max(0.0, min(100.0, oversold))
    overbought = max(0.0, min(100.0, overbought))
    prices = pd.Series(prices).astype(float)
    deltas = prices.diff()
    gains = deltas.clip(lower=0)
    losses = -deltas.clip(upper=0)
    # Use exponential moving average for smoothness
    avg_gain = gains.ewm(span=n, adjust=False).mean()
    avg_loss = losses.ewm(span=n, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    # Generate signal based on rule
    signal = pd.Series(False, index=rsi.index)
    if rule == "signal":
        # crossover: from below oversold to above oversold
        below = rsi.shift(1) < oversold
        above = rsi >= oversold
        signal = below & above
    elif rule == "oversold":
        signal = rsi < oversold
    elif rule == "overbought":
        signal = rsi > overbought
    else:
        raise ValueError(f"Invalid rule: {rule}")
    return rsi, signal


def calculate_adx(
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    n: int = 14,
    min_adx: float = 20.0,
) -> Tuple[pd.Series, pd.Series]:
    """Calculate the Average Directional Index (ADX) and generate a signal.

    The ADX measures trend strength.  A commonly used rule is to buy when
    the ADX crosses above ``min_adx``.

    Returns the ADX and a boolean signal array indicating where the ADX is
    above the threshold.
    """
    high = pd.Series(high).astype(float)
    low = pd.Series(low).astype(float)
    close = pd.Series(close).astype(float)

    plus_dm = high.diff()
    minus_dm = low.diff()
    plus_dm = np.where((plus_dm > minus_dm) & (plus_dm > 0), plus_dm, 0.0)
    minus_dm = np.where((minus_dm > plus_dm) & (minus_dm > 0), minus_dm, 0.0)

    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    atr = tr.rolling(window=n, min_periods=n).mean()
    plus_di = 100.0 * (pd.Series(plus_dm).rolling(window=n, min_periods=n).sum() / atr)
    minus_di = 100.0 * (pd.Series(minus_dm).rolling(window=n, min_periods=n).sum() / atr)
    dx = (abs(plus_di - minus_di) / (plus_di + minus_di)) * 100.0
    adx = dx.rolling(window=n, min_periods=n).mean()
    signal = adx >= min_adx
    return adx, signal


def calculate_aroon(
    high: Sequence[float],
    low: Sequence[float],
    n: int = 25,
    up_ge: float = 70.0,
    dn_le: float = 30.0,
) -> Tuple[pd.DataFrame, pd.Series]:
    """Compute the Aroon indicator and generate a signal.

    The Aroon indicator measures whether a stock is hitting new highs or lows
    over the lookback period.  ``aroon_up`` approaches 100 when prices are
    making new highs; ``aroon_down`` approaches 100 when prices are making
    new lows.  A simple rule is to buy when ``aroon_up >= up_ge`` and
    ``aroon_down <= dn_le``.

    Returns a DataFrame with columns ``aroon_up`` and ``aroon_down``, and a
    boolean signal series.
    """
    high = pd.Series(high).astype(float)
    low = pd.Series(low).astype(float)
    aroon_up = pd.Series(index=high.index, dtype=float)
    aroon_down = pd.Series(index=high.index, dtype=float)
    for i in range(len(high)):
        if i < n - 1:
            aroon_up.iloc[i] = np.nan
            aroon_down.iloc[i] = np.nan
        else:
            hh_idx = high.iloc[i - n + 1:i + 1].idxmax()
            ll_idx = low.iloc[i - n + 1:i + 1].idxmin()
            hh_dist = i - high.index.get_loc(hh_idx)
            ll_dist = i - low.index.get_loc(ll_idx)
            aroon_up.iloc[i] = 100.0 * (n - hh_dist) / n
            aroon_down.iloc[i] = 100.0 * (n - ll_dist) / n
    aroon_df = pd.DataFrame({"aroon_up": aroon_up, "aroon_down": aroon_down})
    signal = (aroon_df["aroon_up"] >= up_ge) & (aroon_df["aroon_down"] <= dn_le)
    return aroon_df, signal


def calculate_stochastic(
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    k_n: int = 14,
    d_n: int = 3,
    signal_rule: str = "signal",
    threshold: float = 20.0,
) -> Tuple[pd.DataFrame, pd.Series]:
    """Compute the stochastic oscillator (%%K and %%D) and generate a signal.

    ``signal_rule`` can be ``signal`` (buy when %%K crosses above ``threshold``),
    ``oversold`` (buy when %%K < ``threshold``) or ``overbought`` (buy when
    %%K > 100 - threshold).  ``threshold`` is often set around 20 for
    oversold/overbought conditions.
    """
    high = pd.Series(high).astype(float)
    low = pd.Series(low).astype(float)
    close = pd.Series(close).astype(float)
    lowest_low = low.rolling(window=k_n, min_periods=k_n).min()
    highest_high = high.rolling(window=k_n, min_periods=k_n).max()
    percent_k = 100.0 * (close - lowest_low) / (highest_high - lowest_low)
    percent_d = percent_k.rolling(window=d_n, min_periods=d_n).mean()
    result = pd.DataFrame({"%K": percent_k, "%D": percent_d})
    signal = pd.Series(False, index=percent_k.index)
    thresh_upper = 100 - threshold
    if signal_rule == "signal":
        cross = (percent_k.shift(1) < threshold) & (percent_k >= threshold)
        signal = cross
    elif signal_rule == "oversold":
        signal = percent_k < threshold
    elif signal_rule == "overbought":
        signal = percent_k > thresh_upper
    else:
        raise ValueError(f"Invalid signal_rule: {signal_rule}")
    return result, signal


def calculate_macd(
    prices: Sequence[float],
    fast_n: int = 12,
    slow_n: int = 26,
    signal_n: int = 9,
    rule: str = "signal",
) -> Tuple[pd.DataFrame, pd.Series]:
    """Compute the Moving Average Convergence Divergence (MACD) and generate a signal.

    ``rule`` can be ``signal`` (buy when MACD crosses above the signal line), or
    ``positive`` (buy when MACD > 0).
    """
    prices = pd.Series(prices).astype(float)
    ema_fast = prices.ewm(span=fast_n, adjust=False).mean()
    ema_slow = prices.ewm(span=slow_n, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal_line = macd.ewm(span=signal_n, adjust=False).mean()
    df = pd.DataFrame({"macd": macd, "signal": signal_line})
    signal = pd.Series(False, index=df.index)
    if rule == "signal":
        cross = (macd.shift(1) < signal_line.shift(1)) & (macd >= signal_line)
        signal = cross
    elif rule == "positive":
        signal = macd > 0
    else:
        raise ValueError(f"Invalid rule for MACD: {rule}")
    return df, signal


def calculate_obv(
    prices: Sequence[float],
    volume: Sequence[float],
    rule: str = "rise",
) -> Tuple[pd.Series, pd.Series]:
    """Compute On‑Balance Volume (OBV) and generate a signal.

    ``rule`` can be ``rise`` (buy when OBV crosses above its own moving average),
    or ``positive`` (buy when OBV > 0).
    """
    prices = pd.Series(prices).astype(float)
    volume = pd.Series(volume).astype(float)
    obv = pd.Series(index=prices.index, dtype=float)
    obv.iloc[0] = volume.iloc[0]
    for i in range(1, len(prices)):
        if prices.iloc[i] > prices.iloc[i - 1]:
            obv.iloc[i] = obv.iloc[i - 1] + volume.iloc[i]
        elif prices.iloc[i] < prices.iloc[i - 1]:
            obv.iloc[i] = obv.iloc[i - 1] - volume.iloc[i]
        else:
            obv.iloc[i] = obv.iloc[i - 1]
    signal = pd.Series(False, index=obv.index)
    if rule == "rise":
        ma = obv.rolling(window=20, min_periods=20).mean()
        cross = (obv.shift(1) < ma.shift(1)) & (obv >= ma)
        signal = cross
    elif rule == "positive":
        signal = obv > 0
    else:
        raise ValueError(f"Invalid rule for OBV: {rule}")
    return obv, signal


def calculate_ema_cross(
    prices: Sequence[float],
    short_n: int = 12,
    long_n: int = 26,
) -> Tuple[pd.DataFrame, pd.Series]:
    """Compute two exponential moving averages and generate a crossover signal.

    A buy signal is produced when the shorter moving average crosses above the
    longer moving average (golden cross).
    """
    prices = pd.Series(prices).astype(float)
    ema_short = prices.ewm(span=short_n, adjust=False).mean()
    ema_long = prices.ewm(span=long_n, adjust=False).mean()
    cross = (ema_short.shift(1) < ema_long.shift(1)) & (ema_short >= ema_long)
    df = pd.DataFrame({"ema_short": ema_short, "ema_long": ema_long})
    return df, cross


def combine_signals(signals: Sequence[pd.Series], policy: str = "any", k: int = 1) -> pd.Series:
    """Combine multiple boolean signal series into a single series.

    Parameters
    ----------
    signals : sequence of Series of bool
        Each element corresponds to a single indicator's buy signals.  All
        series must be indexed identically.
    policy : {"any", "all", "atleast_k"}
        Combination policy:
        - ``any`` – a combined signal is True if any of the individual signals
          are True on that date.
        - ``all`` – a combined signal is True only if all signals are True.
        - ``atleast_k`` – a combined signal is True if at least ``k`` signals
          are True.
    k : int
        Minimum number of signals required when ``policy`` is ``atleast_k``.

    Returns
    -------
    Series of bool
        Combined signals.
    """
    if not signals:
        raise ValueError("No signals provided")
    # Align all signals
    aligned = pd.concat(signals, axis=1)
    if policy == "any":
        combined = aligned.any(axis=1)
    elif policy == "all":
        combined = aligned.all(axis=1)
    elif policy == "atleast_k":
        combined = aligned.sum(axis=1) >= k
    else:
        raise ValueError(f"Invalid policy: {policy}")
    return combined


def compute_forward_returns(prices: Sequence[float], max_horizon: int = 10) -> pd.DataFrame:
    """Compute forward log returns for horizons from 1 to ``max_horizon`` days.

    Returns
    -------
    DataFrame with columns ``fwd_ret_1d``, ``fwd_ret_2d``, ..., sorted by index
    aligned with the input prices.  The first ``h`` rows of column
    ``fwd_ret_hd`` will be NaN because there is no forward data yet.
    """
    prices = pd.Series(prices).astype(float)
    returns = np.log(prices).diff()
    fwd = pd.DataFrame(index=prices.index)
    for h in range(1, max_horizon + 1):
        fwd_ret = returns.shift(-h).rolling(window=h).sum()
        fwd[f"fwd_ret_{h}d"] = fwd_ret
    return fwd


def calculate_statistics(fwd_returns: pd.DataFrame) -> pd.DataFrame:
    """Calculate summary statistics for forward returns."""
    stats = pd.DataFrame(index=["mean", "median", "std", "skew", "kurt"])
    for col in fwd_returns.columns:
        series = fwd_returns[col].dropna()
        if series.empty:
            stats[col] = np.nan
            continue
        mean = series.mean()
        median = series.median()
        std = series.std(ddof=0)
        skew = series.skew()
        kurt = series.kurt()
        stats[col] = [mean, median, std, skew, kurt]
    return stats


def run_backtest_for_all(
    adj_wide: pd.DataFrame,
    high_wide: pd.DataFrame,
    low_wide: pd.DataFrame,
    close_wide: pd.DataFrame,
    volume_wide: Optional[pd.DataFrame],
    config: Optional[Mapping[str, Any]] = None,
    max_horizon: int = 10,
    hist_horizon: int = 1,
    allowed_symbols: Optional[Sequence[str]] = None,
) -> Dict[str, pd.DataFrame]:
    """Run indicator-driven backtests across all tickers in the wide tables.

    Returns a dictionary with the combined trade ``picks``, summary
    ``statistics``, histogram-ready ``hist_data`` for the requested horizon,
    and the filtered ``universe`` of tickers that were evaluated.
    """
    cfg = IndicatorConfig.from_mapping(config)
    if not cfg.enabled():
        raise ValueError("At least one indicator must be enabled.")
    if hist_horizon < 1 or hist_horizon > max_horizon:
        raise ValueError("hist_horizon must be between 1 and max_horizon.")

    def prep(frame: pd.DataFrame) -> pd.DataFrame:
        if frame is None:
            raise ValueError("Wide table is required but missing")
        if "date" not in frame.columns:
            raise ValueError("Wide tables must include a 'date' column.")
        result = frame.copy()
        result["date"] = pd.to_datetime(result["date"])
        result = result.drop_duplicates(subset="date").set_index("date").sort_index()
        return result

    adj = prep(adj_wide)
    high = prep(high_wide)
    low = prep(low_wide)
    close = prep(close_wide)
    volume = prep(volume_wide) if volume_wide is not None else None

    allowed_set = set(allowed_symbols) if allowed_symbols is not None else None
    tickers = [
        col
        for col in adj.columns
        if adj[col].notna().any() and (allowed_set is None or col in allowed_set)
    ]
    if cfg.use_obv and volume is None:
        raise ValueError("Volume data is required when OBV is enabled.")

    min_obs = max(
        max_horizon + 1,
        cfg.rsi_n if cfg.use_rsi else 0,
        cfg.adx_n if cfg.use_adx else 0,
        cfg.aroon_n if cfg.use_aroon else 0,
        cfg.stoch_k if cfg.use_stoch else 0,
        cfg.macd_slow if cfg.use_macd else 0,
        cfg.ema_long if cfg.use_ema else 0,
    )

    picks: List[Dict[str, Any]] = []
    return_cols = [f"fwd_ret_{h}d" for h in range(1, max_horizon + 1)]

    for symbol in tickers:
        if symbol not in high.columns or symbol not in low.columns or symbol not in close.columns:
            continue
        data = pd.DataFrame({
            "adj": adj[symbol],
            "high": high[symbol],
            "low": low[symbol],
            "close": close[symbol],
        }).dropna(subset=["adj", "high", "low", "close"])
        if data.empty or len(data) < min_obs:
            continue
        if cfg.use_obv:
            if volume is None or symbol not in volume.columns:
                raise ValueError(f"Volume data missing for symbol {symbol}.")
            data = data.join(volume[symbol].rename("volume"))
            data.dropna(subset="volume", inplace=True)
            if data.empty:
                continue

        signal_map: Dict[str, pd.Series] = {}
        if cfg.use_rsi:
            _, sig = calculate_rsi(
                data["adj"],
                n=cfg.rsi_n,
                oversold=cfg.rsi_oversold,
                overbought=cfg.rsi_overbought,
                rule=cfg.rsi_rule,
            )
            signal_map["RSI"] = sig.reindex(data.index).fillna(False)
        if cfg.use_adx:
            _, sig = calculate_adx(
                data["high"],
                data["low"],
                data["close"],
                n=cfg.adx_n,
                min_adx=cfg.adx_min,
            )
            signal_map["ADX"] = sig.reindex(data.index).fillna(False)
        if cfg.use_aroon:
            _, sig = calculate_aroon(
                data["high"],
                data["low"],
                n=cfg.aroon_n,
                up_ge=cfg.aroon_up,
                dn_le=cfg.aroon_dn,
            )
            signal_map["Aroon"] = sig.reindex(data.index).fillna(False)
        if cfg.use_stoch:
            _, sig = calculate_stochastic(
                data["high"],
                data["low"],
                data["close"],
                k_n=cfg.stoch_k,
                d_n=cfg.stoch_d,
                signal_rule=cfg.stoch_rule,
                threshold=cfg.stoch_thresh,
            )
            signal_map["Stochastic"] = sig.reindex(data.index).fillna(False)
        if cfg.use_macd:
            _, sig = calculate_macd(
                data["adj"],
                fast_n=cfg.macd_fast,
                slow_n=cfg.macd_slow,
                signal_n=cfg.macd_signal,
                rule=cfg.macd_rule,
            )
            signal_map["MACD"] = sig.reindex(data.index).fillna(False)
        if cfg.use_obv:
            _, sig = calculate_obv(
                data["adj"],
                data["volume"],
                rule=cfg.obv_rule,
            )
            signal_map["OBV"] = sig.reindex(data.index).fillna(False)
        if cfg.use_ema:
            _, sig = calculate_ema_cross(
                data["adj"],
                short_n=cfg.ema_short,
                long_n=cfg.ema_long,
            )
            signal_map["EMA"] = sig.reindex(data.index).fillna(False)

        if not signal_map:
            continue
        signal_frame = pd.DataFrame(signal_map, index=data.index).fillna(False).astype(bool)
        aligned_signals = [signal_frame[col] for col in signal_frame.columns]
        combined = combine_signals(aligned_signals, policy=cfg.policy, k=cfg.atleast_k)
        combined = combined.reindex(data.index).fillna(False).astype(bool)
        if not combined.any():
            continue

        fwd = compute_forward_returns(data["adj"], max_horizon=max_horizon)
        selected = fwd[combined]
        selected = selected.dropna(how="all")
        if selected.empty:
            continue
        signals_at_hits = signal_frame.loc[selected.index]
        prices_at_hits = data.loc[selected.index, "adj"]

        for ts in selected.index:
            triggered = [name for name in signals_at_hits.columns if bool(signals_at_hits.at[ts, name])]
            record: Dict[str, Any] = {
                "date": ts,
                "symbol": symbol,
                "adj_close": prices_at_hits.at[ts],
                "trigger_count": len(triggered),
                "triggered_signals": ", ".join(triggered),
            }
            row = selected.loc[ts]
            for col in selected.columns:
                record[col] = row[col]
            picks.append(record)

    if picks:
        picks_df = pd.DataFrame(picks)
        picks_df.sort_values("date", inplace=True)
        picks_df.reset_index(drop=True, inplace=True)
    else:
        cols = ["date", "symbol", "adj_close", "trigger_count", "triggered_signals"] + return_cols
        picks_df = pd.DataFrame(columns=cols)

    stats_df = calculate_statistics(picks_df[return_cols])
    hist_col = f"fwd_ret_{hist_horizon}d"
    if hist_col not in picks_df.columns:
        hist_df = pd.DataFrame(columns=["date", "symbol", hist_col])
    else:
        hist_df = picks_df[["date", "symbol", hist_col]].dropna(subset=[hist_col])

    universe_df = pd.DataFrame({"symbol": tickers})

    return {
        "picks": picks_df,
        "statistics": stats_df,
        "hist_data": hist_df,
        "universe": universe_df,
    }



def plot_histogram(
    fwd_returns: pd.Series,
    bin_size: float = 0.01,
    title: Optional[str] = None,
) -> None:
    """Plot a histogram of forward returns using matplotlib.

    The ``bin_size`` controls the width of the histogram bins.  For example,
    a bin_size of 0.01 groups returns in 1 % increments.
    """
    series = fwd_returns.dropna()
    if series.empty:
        print("No data to plot")
        return
    bins = np.arange(series.min(), series.max() + bin_size, bin_size)
    plt.figure(figsize=(6, 4))
    plt.hist(series, bins=bins, edgecolor='k')
    plt.xlabel("Forward Return")
    plt.ylabel("Frequency")
    if title:
        plt.title(title)
    plt.tight_layout()
    plt.show()


def simulate_price_series(n: int = 200, seed: int = 0) -> pd.DataFrame:
    """Generate a synthetic price series for demonstration purposes.

    Creates a simple geometric random walk with normally distributed log
    returns.  Returns a DataFrame with columns resembling a typical OHLCV
    dataset.  Use this when no external data source is available.
    """
    rng = np.random.default_rng(seed)
    # simulate log returns with small drift and volatility
    log_rets = rng.normal(loc=0.0005, scale=0.02, size=n)
    prices = np.exp(np.cumsum(log_rets)) * 100.0
    # derive high/low/close as random deviations around synthetic close
    high = prices * (1 + rng.uniform(0, 0.02, size=n))
    low = prices * (1 - rng.uniform(0, 0.02, size=n))
    openp = prices * (1 + rng.uniform(-0.01, 0.01, size=n))
    volume = rng.integers(low=1_000_000, high=10_000_000, size=n)
    dates = pd.date_range(end=dt.date.today(), periods=n)
    return pd.DataFrame({
        "date": dates,
        "open": openp,
        "high": high,
        "low": low,
        "close": prices,
        "adj_close": prices,
        "volume": volume,
    })


if __name__ == "__main__":
    # Demonstration of the back‑testing pipeline using synthetic data.
    print("Running demonstration using synthetic price data...")
    data = simulate_price_series(n=300, seed=42)
    prices = data["adj_close"]
    high = data["high"]
    low = data["low"]
    close = data["close"]
    volume = data["volume"]

    # Compute indicators and signals
    rsi, rsi_sig = calculate_rsi(prices, n=14, oversold=30, overbought=70, rule="signal")
    adx, adx_sig = calculate_adx(high, low, close, n=14, min_adx=20)
    aroon_df, aroon_sig = calculate_aroon(high, low, n=25, up_ge=70, dn_le=30)
    macd_df, macd_sig = calculate_macd(prices, fast_n=12, slow_n=26, signal_n=9, rule="signal")
    obv, obv_sig = calculate_obv(prices, volume, rule="rise")
    ema_df, ema_sig = calculate_ema_cross(prices, short_n=12, long_n=26)

    # Combine signals: require at least 2 of the selected indicators to trigger
    combined_signal = combine_signals([
        rsi_sig, adx_sig, aroon_sig, macd_sig, obv_sig, ema_sig
    ], policy="atleast_k", k=2)

    # Compute forward returns for horizons 1–10 days
    fwd = compute_forward_returns(prices, max_horizon=10)
    # Filter returns to rows where a combined signal was generated
    fwd_selected = fwd[combined_signal]
    stats = calculate_statistics(fwd_selected)
    print("Summary statistics of forward returns (synthetic demo):")
    print(stats.round(4))
    # Plot histogram for a specific horizon (e.g., 1‑day forward return)
    plot_histogram(fwd_selected["fwd_ret_1d"], bin_size=0.005,
                   title="Synthetic 1‑Day Forward Return Distribution")
