from __future__ import annotations

import sys
import pathlib
import platform
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Literal, Optional, Sequence, Tuple

# Work around macOS python_implementation parsing bug before importing pandas
try:
    platform.python_implementation()
except ValueError:
    def _patched_sys_version():
        version = sys.version.split()[0]
        return ("CPython", version, "", "", "", "")

    platform._sys_version = _patched_sys_version  # type: ignore[attr-defined]

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from pandas.tseries import offsets

# Ensure we can import the existing backtesting engine and locate data assets
BACKEND_ROOT = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.append(str(path))

import backtest_system  # type: ignore

DATA_DIR = PROJECT_ROOT / "data"
MIN_BACKTEST_DATE = pd.Timestamp("2020-01-01")
MAX_LOOKBACK_YEARS = 5


def _parse_date(value: str) -> pd.Timestamp:
    try:
        ts = pd.to_datetime(value)
    except ValueError as exc:  # pragma: no cover - defensive parsing
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc
    if pd.isna(ts):
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}")
    return ts.normalize()


def _enforce_date_window(start: str, end: str) -> Tuple[pd.Timestamp, pd.Timestamp]:
    start_ts = _parse_date(start)
    end_ts = _parse_date(end)
    if start_ts > end_ts:
        raise HTTPException(status_code=400, detail="start date must be before end date")

    today = pd.Timestamp.today().normalize()
    if end_ts > today:
        end_ts = today

    min_allowed_start = max(MIN_BACKTEST_DATE, end_ts - pd.DateOffset(years=MAX_LOOKBACK_YEARS))
    if start_ts < min_allowed_start:
        raise HTTPException(
            status_code=400,
            detail=(
                "Date range exceeds allowed window. Choose a start date on or after "
                f"{min_allowed_start.strftime('%Y-%m-%d')}"
            ),
        )

    return start_ts, end_ts

app = FastAPI(title="Backtesting Adapter API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RSIRule(BaseModel):
    mode: Literal["oversold", "overbought"] = "oversold"
    threshold: int = Field(30, ge=0, le=100)


class Filters(BaseModel):
    sectors: Optional[List[str]] = None
    mcap_min: Optional[float] = Field(default=None, ge=0)
    mcap_max: Optional[float] = Field(default=None, ge=0)
    exclude_tickers: Optional[List[str]] = None

    @validator("exclude_tickers")
    def _normalise(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        cleaned = [tok.strip().upper() for tok in v if tok.strip()]
        return cleaned or None


class BacktestParams(BaseModel):
    strategy: str
    indicators: Dict[str, Any] = Field(default_factory=dict)
    rsi_rule: Optional[RSIRule] = None
    filters: Optional[Filters] = None
    universe: Optional[List[str]] = None
    start: str
    end: str
    capital: Optional[float] = 100_000.0
    fee_bps: Optional[float] = 1.0
    hold_days: Optional[int] = Field(default=None, ge=1)
    stop_loss_pct: Optional[float] = Field(default=None, ge=0.0)
    take_profit_pct: Optional[float] = Field(default=None, ge=0.0)


class TimeSeries(BaseModel):
    dates: List[str]
    values: List[float]


class Signal(BaseModel):
    date: str
    type: Literal["buy", "sell"] = "buy"
    price: float
    symbol: Optional[str] = None
    size: Optional[float] = None


class Trade(BaseModel):
    enter_date: str
    enter_price: float
    exit_date: str
    exit_price: float
    pnl: float
    ret: float
    symbol: Optional[str] = None


class HistogramBucket(BaseModel):
    bin_start: float
    bin_end: float
    count: int


class HistogramPayload(BaseModel):
    horizon: int
    buckets: List[HistogramBucket]
    stats: Dict[str, float] = Field(default_factory=dict)
    sample_size: int = 0


class BacktestResponse(BaseModel):
    equity_curve: TimeSeries
    drawdown_curve: TimeSeries
    price_series: Optional[TimeSeries] = None
    signals: List[Signal] = Field(default_factory=list)
    trades: List[Trade] = Field(default_factory=list)
    metrics: Dict[str, float] = Field(default_factory=dict)
    histogram: Optional[HistogramPayload] = None
    indicator_statistics: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    universe_size: int
    trades_count: int


def _load_metadata() -> Optional[pd.DataFrame]:
    meta_path = DATA_DIR / "sp500_metadata.feather"
    if meta_path.exists():
        df = pd.read_feather(meta_path)
        df = df.rename(columns={"symbol": "ticker"})
        return df
    return None


@lru_cache(maxsize=1)
def _load_wide_tables() -> Dict[str, pd.DataFrame]:
    tables: Dict[str, pd.DataFrame] = {}
    required = {
        "adj": DATA_DIR / "adjclose_wide.feather",
        "high": DATA_DIR / "high_wide.feather",
        "low": DATA_DIR / "low_wide.feather",
        "close": DATA_DIR / "close_wide.feather",
        "volume": DATA_DIR / "volume_wide.feather",
    }
    missing = [name for name, path in required.items() if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Missing wide tables in data directory: " + ", ".join(missing)
        )
    for key, path in required.items():
        df = pd.read_feather(path)
        df["date"] = pd.to_datetime(df["date"])  # ensure datetime
        tables[key] = df
    return tables


def _filter_tables_by_date(
    tables: Dict[str, pd.DataFrame],
    start: pd.Timestamp,
    end: pd.Timestamp,
) -> Dict[str, pd.DataFrame]:
    filtered: Dict[str, pd.DataFrame] = {}
    for name, table in tables.items():
        if "date" not in table.columns:
            filtered[name] = table
            continue
        frame = table.copy()
        frame["date"] = pd.to_datetime(frame["date"])
        mask = (frame["date"] >= start) & (frame["date"] <= end)
        filtered[name] = frame.loc[mask].reset_index(drop=True)
    return filtered


def _build_universe(filters: Optional[Filters], explicit: Optional[List[str]]) -> pd.DataFrame:
    metadata = _load_metadata()
    if metadata is None:
        # fall back to using symbol list from wide table
        tickers = [col for col in _load_wide_tables()["adj"].columns if col != "date"]
        df = pd.DataFrame({"ticker": tickers})
    else:
        df = metadata.copy()

    if filters:
        if filters.sectors and "sector" in df.columns:
            df = df[df["sector"].isin(filters.sectors)]
        if filters.mcap_min is not None and "market_cap" in df.columns:
            df = df[df["market_cap"] >= filters.mcap_min]
        if filters.mcap_max is not None and "market_cap" in df.columns:
            df = df[df["market_cap"] <= filters.mcap_max]
        if filters.exclude_tickers:
            df = df[~df["ticker"].isin(filters.exclude_tickers)]

    if explicit:
        df = df[df["ticker"].isin([ticker.upper() for ticker in explicit])]

    if df.empty:
        raise HTTPException(status_code=400, detail="Universe filter removed all tickers.")

    return df.drop_duplicates(subset="ticker")


def _map_indicators(payload: BacktestParams) -> Dict[str, Any]:
    indicators = dict(payload.indicators)
    rsi_cfg = dict(indicators.get("rsi", {}))
    if payload.rsi_rule:
        rsi_cfg.setdefault("use", True)
        rsi_cfg.setdefault("n", rsi_cfg.get("n", 14))
        if payload.rsi_rule.mode == "oversold":
            rsi_cfg["rule"] = "oversold"
            rsi_cfg["oversold"] = payload.rsi_rule.threshold
        else:
            rsi_cfg["rule"] = "overbought"
            rsi_cfg["overbought"] = payload.rsi_rule.threshold
    if rsi_cfg:
        indicators["rsi"] = rsi_cfg
    else:
        indicators.pop("rsi", None)
    return indicators


def _build_config(indicators: Dict[str, Any]) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {
        "use_rsi": False,
        "rsi_n": 14,
        "rsi_rule": "signal",
        "rsi_oversold": 30.0,
        "rsi_overbought": 70.0,
        "use_stoch": False,
        "stoch_k": 14,
        "stoch_d": 3,
        "stoch_rule": "signal",
        "stoch_thresh": 20.0,
        "use_adx": False,
        "adx_n": 14,
        "adx_min": 20.0,
        "use_aroon": False,
        "aroon_n": 25,
        "aroon_up": 70.0,
        "aroon_dn": 30.0,
        "use_macd": False,
        "macd_fast": 12,
        "macd_slow": 26,
        "macd_signal": 9,
        "macd_rule": "signal",
        "use_obv": False,
        "obv_rule": "rise",
        "use_ema": False,
        "ema_short": 12,
        "ema_long": 26,
        "policy": indicators.get("policy", "any"),
        "atleast_k": indicators.get("atleast_k", 2),
    }

    if "rsi" in indicators:
        rsi_opts = indicators["rsi"]
        cfg["use_rsi"] = rsi_opts.get("use", True)
        cfg["rsi_n"] = rsi_opts.get("n", cfg["rsi_n"])
        if "rule" in rsi_opts:
            cfg["rsi_rule"] = rsi_opts["rule"]
        if "oversold" in rsi_opts:
            cfg["rsi_oversold"] = rsi_opts["oversold"]
        if "overbought" in rsi_opts:
            cfg["rsi_overbought"] = rsi_opts["overbought"]
    if "stoch" in indicators:
        stoch = indicators["stoch"]
        cfg["use_stoch"] = stoch.get("use", True)
        cfg["stoch_k"] = stoch.get("k", cfg["stoch_k"])
        cfg["stoch_d"] = stoch.get("d", cfg["stoch_d"])
        cfg["stoch_rule"] = stoch.get("rule", cfg["stoch_rule"])
        cfg["stoch_thresh"] = stoch.get("threshold", cfg["stoch_thresh"])
    if "adx" in indicators:
        adx = indicators["adx"]
        cfg["use_adx"] = adx.get("use", True)
        cfg["adx_n"] = adx.get("n", cfg["adx_n"])
        cfg["adx_min"] = adx.get("min", cfg["adx_min"])
    if "aroon" in indicators:
        aroon = indicators["aroon"]
        cfg["use_aroon"] = aroon.get("use", True)
        cfg["aroon_n"] = aroon.get("n", cfg["aroon_n"])
        cfg["aroon_up"] = aroon.get("up", cfg["aroon_up"])
        cfg["aroon_dn"] = aroon.get("down", cfg["aroon_dn"])
    if "macd" in indicators:
        macd = indicators["macd"]
        cfg["use_macd"] = macd.get("use", True)
        cfg["macd_fast"] = macd.get("fast", cfg["macd_fast"])
        cfg["macd_slow"] = macd.get("slow", cfg["macd_slow"])
        cfg["macd_signal"] = macd.get("signal", cfg["macd_signal"])
        cfg["macd_rule"] = macd.get("rule", cfg["macd_rule"])
    if "obv" in indicators:
        obv = indicators["obv"]
        cfg["use_obv"] = obv.get("use", True)
        cfg["obv_rule"] = obv.get("rule", cfg["obv_rule"])
    if "ema" in indicators:
        ema = indicators["ema"]
        cfg["use_ema"] = ema.get("use", True)
        cfg["ema_short"] = ema.get("short", cfg["ema_short"])
        cfg["ema_long"] = ema.get("long", cfg["ema_long"])

    if "policy" in indicators:
        cfg["policy"] = indicators["policy"]
    if "atleast_k" in indicators:
        cfg["atleast_k"] = indicators["atleast_k"]
    return cfg


def _build_equity(returns_df: pd.DataFrame, initial_capital: float = 1.0) -> pd.Series:
    if returns_df.empty:
        return pd.Series(dtype=float)
    returns = (
        returns_df.groupby("date")["ret"].mean()
        .sort_index()
    )
    if returns.empty:
        return pd.Series(dtype=float)
    equity = initial_capital * (1.0 + returns).cumprod()
    equity.name = "equity"
    return equity


def _compute_drawdown(equity: pd.Series) -> pd.Series:
    if equity.empty:
        return pd.Series(dtype=float)
    running_max = equity.cummax()
    dd = equity / running_max - 1.0
    dd.name = "drawdown"
    return dd


def _build_signals_and_trades(
    picks: pd.DataFrame,
    hold_days: int,
    fee_bps: float,
    stop_loss_pct: Optional[float],
    take_profit_pct: Optional[float],
) -> Tuple[List[Signal], List[Trade], pd.DataFrame]:
    if picks.empty:
        return [], [], pd.DataFrame(columns=["date", "ret"])

    fee_rate = (fee_bps or 0.0) / 10_000.0
    hold_days = max(1, hold_days)
    ret_col = f"fwd_ret_{hold_days}d"
    if ret_col not in picks.columns:
        return [], [], pd.DataFrame(columns=["date", "ret"])

    signals: List[Signal] = []
    trades: List[Trade] = []
    realised_returns: List[Dict[str, Any]] = []

    stop_loss = abs(stop_loss_pct) if stop_loss_pct is not None else None
    take_profit = take_profit_pct if take_profit_pct is not None else None

    for _, row in picks.iterrows():
        enter_date = row["date"]
        enter_price = float(row["adj_close"])
        raw_ret = row.get(ret_col)
        if pd.isna(raw_ret):
            continue
        gross_ret = float(raw_ret)
        gross_simple = float(np.exp(gross_ret) - 1.0)
        if stop_loss is not None:
            gross_simple = max(gross_simple, -stop_loss)
        if take_profit is not None:
            gross_simple = min(gross_simple, take_profit)

        net_simple = gross_simple - 2 * fee_rate
        exit_price = enter_price * (1 + net_simple)
        exit_date = enter_date + offsets.BDay(hold_days)

        if exit_price <= 0:
            continue

        signals.append(
            Signal(
                date=str(enter_date.date()),
                price=enter_price,
                symbol=row.get("symbol"),
                type="buy",
            )
        )
        signals.append(
            Signal(
                date=str(exit_date.date()),
                price=float(exit_price),
                symbol=row.get("symbol"),
                type="sell",
            )
        )

        trades.append(
            Trade(
                enter_date=str(enter_date.date()),
                enter_price=enter_price,
                exit_date=str(exit_date.date()),
                exit_price=float(exit_price),
                pnl=float(exit_price - enter_price),
                ret=float(net_simple),
                symbol=row.get("symbol"),
            )
        )

        realised_returns.append(
            {
                "date": exit_date.normalize(),
                "ret": float(net_simple),
            }
        )

    returns_df = pd.DataFrame(realised_returns)
    return signals, trades, returns_df


def _compute_metrics(equity: pd.Series, drawdown: pd.Series) -> Dict[str, float]:
    metrics: Dict[str, float] = {}
    if equity.empty:
        return metrics
    returns = equity.pct_change().dropna()
    if not returns.empty:
        avg_daily = returns.mean()
        vol_daily = returns.std()
        annual_factor = np.sqrt(252)
        metrics["avg_daily_return"] = float(avg_daily)
        metrics["volatility_daily"] = float(vol_daily)
        metrics["annualized_return"] = float(((1 + avg_daily) ** 252) - 1)
        metrics["annualized_vol"] = float(vol_daily * annual_factor)
        if vol_daily > 0:
            metrics["sharpe"] = float(avg_daily / vol_daily * annual_factor)
    if not drawdown.empty:
        metrics["max_drawdown"] = float(drawdown.min())
    metrics["ending_equity"] = float(equity.iloc[-1])
    return metrics


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/universe/meta")
def universe_meta() -> Dict[str, Any]:
    metadata = _load_metadata()
    if metadata is not None and "sector" in metadata.columns:
        sectors = sorted(metadata["sector"].dropna().unique().tolist())
        caps = metadata["market_cap"].dropna()
        if not caps.empty:
            buckets = [
                {"label": "Micro (<$500M)", "min": 0, "max": 5e8},
                {"label": "Small ($0.5B–$2B)", "min": 5e8, "max": 2e9},
                {"label": "Mid ($2B–$10B)", "min": 2e9, "max": 1e10},
                {"label": "Large (>$10B)", "min": 1e10, "max": float(caps.max())},
            ]
        else:
            buckets = []
        return {"sectors": sectors, "mcap_buckets": buckets}

    # Fallback static lists
    sectors = ["Energy", "Technology", "Financials", "Healthcare", "Industrials", "Consumer"]
    mcap_buckets = [
        {"label": "Micro (<$300M)", "min": 0, "max": 3e8},
        {"label": "Small ($300M–$2B)", "min": 3e8, "max": 2e9},
        {"label": "Mid ($2B–$10B)", "min": 2e9, "max": 1e10},
        {"label": "Large (>$10B)", "min": 1e10, "max": 1e12},
    ]
    return {"sectors": sectors, "mcap_buckets": mcap_buckets}


@app.post("/run_backtest", response_model=BacktestResponse)
def run_backtest(payload: BacktestParams) -> BacktestResponse:
    start_ts, end_ts = _enforce_date_window(payload.start, payload.end)
    universe_df = _build_universe(payload.filters, payload.universe)
    tickers = universe_df["ticker"].tolist()

    tables = _filter_tables_by_date(_load_wide_tables(), start_ts, end_ts)
    if tables["adj"].empty:
        raise HTTPException(
            status_code=400,
            detail="No price data found for the selected date range."
        )
    indicators = _map_indicators(payload)
    config = _build_config(indicators)
    max_horizon = payload.indicators.get("max_horizon", 10)
    hist_horizon = payload.indicators.get("hist_horizon", 1)
    hold_days = payload.hold_days or payload.indicators.get("hold_days") or 1
    if hold_days > max_horizon:
        hold_days = max_horizon
    if hist_horizon > max_horizon:
        hist_horizon = max_horizon
    if hist_horizon < 1:
        hist_horizon = 1

    result = backtest_system.run_backtest_for_all(
        tables["adj"],
        tables["high"],
        tables["low"],
        tables["close"],
        tables.get("volume"),
        config=config,
        max_horizon=max_horizon,
        hist_horizon=hist_horizon,
        allowed_symbols=tickers,
    )

    picks = result.get("picks", pd.DataFrame())
    if not picks.empty:
        picks = picks.copy()
        if not np.issubdtype(picks["date"].dtype, np.datetime64):
            picks["date"] = pd.to_datetime(picks["date"])
        picks = picks[(picks["date"] >= start_ts) & (picks["date"] <= end_ts)]
    signals, trades, realised_returns = _build_signals_and_trades(
        picks,
        hold_days=hold_days,
        fee_bps=payload.fee_bps or 0.0,
        stop_loss_pct=payload.stop_loss_pct or payload.indicators.get("stop_loss_pct"),
        take_profit_pct=payload.take_profit_pct or payload.indicators.get("take_profit_pct"),
    )
    signals.sort(key=lambda s: (s.date, 0 if s.type == "buy" else 1))
    trades.sort(key=lambda t: (t.enter_date, t.symbol or ""))

    equity = _build_equity(realised_returns, initial_capital=float(payload.capital or 1.0))
    drawdown = _compute_drawdown(equity)

    equity_ts = TimeSeries(dates=[d.strftime("%Y-%m-%d") for d in equity.index], values=equity.round(6).tolist())
    drawdown_ts = TimeSeries(dates=[d.strftime("%Y-%m-%d") for d in drawdown.index], values=drawdown.round(6).tolist())

    metrics = _compute_metrics(equity, drawdown)
    stats_df = result.get("statistics", pd.DataFrame())
    hist_df = result.get("hist_data", pd.DataFrame())

    price_ts: Optional[TimeSeries] = None
    if not picks.empty:
        price_series = picks.groupby("date")["adj_close"].mean().sort_index()
        price_ts = TimeSeries(
            dates=[d.strftime("%Y-%m-%d") for d in price_series.index],
            values=price_series.round(6).tolist(),
        )

    histogram_payload: Optional[HistogramPayload] = None
    hist_col = f"fwd_ret_{hist_horizon}d"
    sample = hist_df[hist_col] if hist_col in hist_df.columns else pd.Series(dtype=float)
    sample_clean = sample.dropna()
    if not sample_clean.empty:
        simple_sample = np.expm1(sample_clean)
        counts, bin_edges = np.histogram(simple_sample, bins=20)
        buckets = [
            HistogramBucket(
                bin_start=float(bin_edges[i]),
                bin_end=float(bin_edges[i + 1]),
                count=int(counts[i]),
            )
            for i in range(len(counts))
        ]
        simple_series = pd.Series(simple_sample)
        stats_for_hist = {
            "mean": float(simple_series.mean()),
            "median": float(simple_series.median()),
            "std": float(simple_series.std(ddof=0)),
            "skew": float(simple_series.skew()),
            "kurt": float(simple_series.kurt()),
        }
        histogram_payload = HistogramPayload(
            horizon=hist_horizon,
            buckets=buckets,
            stats=stats_for_hist,
            sample_size=int(simple_series.shape[0]),
        )

    indicator_stats: Dict[str, Dict[str, float]] = {}
    if not picks.empty:
        for col in [c for c in picks.columns if c.startswith("fwd_ret_")]:
            series = picks[col].dropna()
            if series.empty:
                continue
            simple_series = np.expm1(series)
            indicator_stats[col] = {
                "mean": float(simple_series.mean()),
                "median": float(simple_series.median()),
                "std": float(simple_series.std(ddof=0)),
                "skew": float(simple_series.skew()),
                "kurt": float(simple_series.kurt()),
            }

    return BacktestResponse(
        equity_curve=equity_ts,
        drawdown_curve=drawdown_ts,
        price_series=price_ts,
        signals=signals,
        trades=trades,
        metrics=metrics,
        histogram=histogram_payload,
        indicator_statistics=indicator_stats,
        universe_size=len(tickers),
        trades_count=len(trades),
    )
