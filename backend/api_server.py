from __future__ import annotations

import sys
import pathlib
import platform
import re
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

# Ensure we can import the existing backtesting engine and locate data assets
BACKEND_ROOT = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_ROOT.parent
for path in (PROJECT_ROOT, BACKEND_ROOT):
    if str(path) not in sys.path:
        sys.path.append(str(path))

import backtest_system  # type: ignore
from backend.engine import (
    FeeModel,
    TradeBuilderConfig,
    build_equity_curve,
    build_trades_from_picks,
    compute_drawdown,
    compute_performance_metrics,
    warn_if_returns_constant,
)
from backend.reports.serializer import serialise_trades

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
    hist_bins: Optional[int] = Field(default=20, ge=5, le=100)
    hist_bin_width: Optional[float] = Field(default=0.01, gt=0.0, le=1.0)


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
    gross_pnl: float
    fees: float
    side: Literal["long", "short"] = "long"
    quantity: float
    notional: float
    buy_fee: float
    sell_fee: float


class HistogramSeries(BaseModel):
    horizon: int
    returns: List[float] = Field(default_factory=list)
    sample_size: int = 0
    stats: Dict[str, float] = Field(default_factory=dict)


class HistogramPayload(BaseModel):
    series: List[HistogramSeries] = Field(default_factory=list)
    bin_width: float = 0.01


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
    initial_capital: float
    ending_equity: float
    total_return: float
    total_fees: float


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
    hold_days = payload.hold_days or payload.indicators.get("hold_days") or 1
    if hold_days > max_horizon:
        hold_days = max_horizon

    result = backtest_system.run_backtest_for_all(
        tables["adj"],
        tables["high"],
        tables["low"],
        tables["close"],
        tables.get("volume"),
        config=config,
        max_horizon=max_horizon,
        allowed_symbols=tickers,
    )

    picks = result.get("picks", pd.DataFrame())
    if not picks.empty:
        picks = picks.copy()
        if not np.issubdtype(picks["date"].dtype, np.datetime64):
            picks["date"] = pd.to_datetime(picks["date"])
        picks = picks[(picks["date"] >= start_ts) & (picks["date"] <= end_ts)]
    initial_capital = float(payload.capital or 1.0)
    fee_model = FeeModel(payload.fee_bps or 0.0)
    trade_config = TradeBuilderConfig(
        hold_days=hold_days,
        fee_model=fee_model,
        initial_capital=initial_capital,
        stop_loss_pct=payload.stop_loss_pct or payload.indicators.get("stop_loss_pct"),
        take_profit_pct=payload.take_profit_pct or payload.indicators.get("take_profit_pct"),
        compound=True,
    )
    execution_result = build_trades_from_picks(picks, trade_config)
    realised_trades = execution_result.trades
    warn_if_returns_constant(realised_trades)

    ledger = execution_result.ledger
    signals: List[Signal] = []
    if not ledger.empty:
        ledger = ledger.sort_values("ts")
        for record in ledger.itertuples():
            ts = pd.to_datetime(record.ts)
            date_str = ts.strftime("%Y-%m-%d")
            side = "buy" if record.event == "buy" else "sell"
            size = float(record.quantity if side == "buy" else -record.quantity)
            signals.append(
                Signal(
                    date=date_str,
                    price=float(record.price),
                    symbol=record.symbol,
                    type=side,
                    size=size,
                )
            )

    trades_payload = serialise_trades(realised_trades)
    trades = [Trade(**item) for item in trades_payload]
    trades.sort(key=lambda t: (t.enter_date, t.symbol or ""))

    equity = build_equity_curve(realised_trades, initial_capital=initial_capital, column="net_pnl")
    drawdown = compute_drawdown(equity)

    equity_ts = (
        TimeSeries(dates=[d.strftime("%Y-%m-%d") for d in equity.index], values=equity.round(6).tolist())
        if not equity.empty
        else TimeSeries(dates=[], values=[])
    )
    drawdown_ts = (
        TimeSeries(dates=[d.strftime("%Y-%m-%d") for d in drawdown.index], values=drawdown.round(6).tolist())
        if not drawdown.empty
        else TimeSeries(dates=[], values=[])
    )

    metrics = compute_performance_metrics(equity, drawdown)
    ending_equity = metrics.get("ending_equity", initial_capital)
    total_return = float(ending_equity / initial_capital - 1.0) if initial_capital else 0.0
    total_fees = float(realised_trades["fees"].sum()) if not realised_trades.empty else 0.0
    stats_df = result.get("statistics", pd.DataFrame())
    hist_df = result.get("hist_data", pd.DataFrame())

    price_ts: Optional[TimeSeries] = None
    if not picks.empty:
        price_series = picks.groupby("date")["adj_close"].mean().sort_index()
        price_ts = TimeSeries(
            dates=[d.strftime("%Y-%m-%d") for d in price_series.index],
            values=price_series.round(6).tolist(),
        )

    def _safe(value: float) -> float:
        if pd.isna(value) or not np.isfinite(value):
            return 0.0
        return float(value)

    histogram_payload: Optional[HistogramPayload] = None
    if not hist_df.empty:
        horizon_cols = [col for col in hist_df.columns if col.startswith("fwd_ret_")]
        series_payload: List[HistogramSeries] = []
        for col in horizon_cols:
            match = re.search(r"fwd_ret_(\d+)d", col)
            if not match:
                continue
            horizon = int(match.group(1))
            sample = hist_df[col].dropna()
            if sample.empty:
                continue
            simple_array = np.expm1(sample)
            simple_series = pd.Series(simple_array)
            simple_series.replace([np.inf, -np.inf], np.nan, inplace=True)
            simple_series.dropna(inplace=True)
            if simple_series.empty:
                continue
            stats_for_hist = {
                "mean": _safe(simple_series.mean()),
                "median": _safe(simple_series.median()),
                "std": _safe(simple_series.std(ddof=0)),
                "skew": _safe(simple_series.skew()),
                "kurt": _safe(simple_series.kurt()),
            }
            rounded = [float(round(val, 8)) for val in simple_series]
            series_payload.append(
                HistogramSeries(
                    horizon=horizon,
                    returns=rounded,
                    sample_size=int(simple_series.shape[0]),
                    stats=stats_for_hist,
                )
            )
        if series_payload:
            series_payload.sort(key=lambda item: item.horizon)
            requested_width = payload.hist_bin_width or 0.01
            safe_width = float(max(0.0005, min(requested_width, 1.0)))
            histogram_payload = HistogramPayload(
                series=series_payload, bin_width=round(safe_width, 6)
            )

    indicator_stats: Dict[str, Dict[str, float]] = {}
    combined_returns: List[pd.Series] = []
    if not picks.empty:
        horizon_columns = [c for c in picks.columns if c.startswith("fwd_ret_")]
        for col in horizon_columns:
            series = picks[col].dropna()
            if series.empty:
                continue
            converted = pd.Series(np.expm1(series))
            converted.replace([np.inf, -np.inf], np.nan, inplace=True)
            converted.dropna(inplace=True)
            if converted.empty:
                continue
            indicator_stats[col] = {
                "mean": _safe(converted.mean()),
                "median": _safe(converted.median()),
                "std": _safe(converted.std(ddof=0)),
                "skew": _safe(converted.skew()),
                "kurt": _safe(converted.kurt()),
            }
            combined_returns.append(converted)

        if combined_returns:
            combined_series = pd.concat(combined_returns, ignore_index=True)
            combined_series.replace([np.inf, -np.inf], np.nan, inplace=True)
            combined_series.dropna(inplace=True)
            if not combined_series.empty:
                indicator_stats = {
                    "combined": {
                        "mean": _safe(combined_series.mean()),
                        "median": _safe(combined_series.median()),
                        "std": _safe(combined_series.std(ddof=0)),
                        "skew": _safe(combined_series.skew()),
                        "kurt": _safe(combined_series.kurt()),
                    },
                    **indicator_stats,
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
        initial_capital=initial_capital,
        ending_equity=ending_equity,
        total_return=total_return,
        total_fees=total_fees,
    )
