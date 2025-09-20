from __future__ import annotations

import sys
import pathlib
import platform
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Literal, Optional

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

# Ensure we can import the existing backtesting engine
BACKTEST_ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(BACKTEST_ROOT) not in sys.path:
    sys.path.append(str(BACKTEST_ROOT))


import backtest_system  # type: ignore

DATA_DIR = BACKTEST_ROOT / "data"

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


class BacktestResponse(BaseModel):
    equity_curve: TimeSeries
    drawdown_curve: TimeSeries
    price_series: Optional[TimeSeries] = None
    signals: List[Signal] = Field(default_factory=list)
    trades: List[Trade] = Field(default_factory=list)
    metrics: Dict[str, float] = Field(default_factory=dict)
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
    if payload.rsi_rule:
        indicators.setdefault("rsi", {})
        indicators["rsi"].update({
            "use": True,
            "n": indicators.get("rsi", {}).get("n", 14),
        })
        if payload.rsi_rule.mode == "oversold":
            indicators["rsi"]["rule"] = "oversold"
            indicators["rsi"]["oversold"] = payload.rsi_rule.threshold
        else:
            indicators["rsi"]["rule"] = "overbought"
            indicators["rsi"]["overbought"] = payload.rsi_rule.threshold
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


def _build_equity(picks: pd.DataFrame) -> pd.Series:
    if picks.empty:
        return pd.Series(dtype=float)
    returns = (
        picks.dropna(subset=["fwd_ret_1d"])
        .groupby("date")["fwd_ret_1d"].mean()
        .sort_index()
    )
    if returns.empty:
        return pd.Series(dtype=float)
    equity = (1.0 + returns).cumprod()
    equity.name = "equity"
    return equity


def _compute_drawdown(equity: pd.Series) -> pd.Series:
    if equity.empty:
        return pd.Series(dtype=float)
    running_max = equity.cummax()
    dd = equity / running_max - 1.0
    dd.name = "drawdown"
    return dd


def _make_signals(picks: pd.DataFrame) -> List[Signal]:
    if picks.empty:
        return []
    signals = [
        Signal(
            date=str(row["date"].date()),
            price=float(row["adj_close"]),
            symbol=row["symbol"],
            type="buy",
        )
        for _, row in picks.iterrows()
    ]
    return signals


def _make_trades(picks: pd.DataFrame) -> List[Trade]:
    trades: List[Trade] = []
    if picks.empty:
        return trades
    for _, row in picks.iterrows():
        enter_date = row["date"]
        enter_price = float(row["adj_close"])
        ret_1d = row.get("fwd_ret_1d")
        if pd.isna(ret_1d):
            continue
        exit_price = enter_price * (1 + ret_1d)
        trade = Trade(
            enter_date=str(enter_date.date()),
            enter_price=enter_price,
            exit_date=str((enter_date + pd.Timedelta(days=1)).date()),
            exit_price=float(exit_price),
            pnl=float(exit_price - enter_price),
            ret=float(ret_1d),
            symbol=row["symbol"],
        )
        trades.append(trade)
    return trades


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
    universe_df = _build_universe(payload.filters, payload.universe)
    tickers = universe_df["ticker"].tolist()

    tables = _load_wide_tables()
    indicators = _map_indicators(payload)
    config = _build_config(indicators)

    result = backtest_system.run_backtest_for_all(
        tables["adj"],
        tables["high"],
        tables["low"],
        tables["close"],
        tables.get("volume"),
        config=config,
        max_horizon=payload.indicators.get("max_horizon", 10),
        hist_horizon=payload.indicators.get("hist_horizon", 1),
        allowed_symbols=tickers,
    )

    picks = result.get("picks", pd.DataFrame())
    if not picks.empty:
        picks = picks.copy()
        if not np.issubdtype(picks["date"].dtype, np.datetime64):
            picks["date"] = pd.to_datetime(picks["date"])
    equity = _build_equity(picks)
    drawdown = _compute_drawdown(equity)

    equity_ts = TimeSeries(dates=[d.strftime("%Y-%m-%d") for d in equity.index], values=equity.round(6).tolist())
    drawdown_ts = TimeSeries(dates=[d.strftime("%Y-%m-%d") for d in drawdown.index], values=drawdown.round(6).tolist())

    signals = _make_signals(picks)
    trades = _make_trades(picks)
    metrics = _compute_metrics(equity, drawdown)

    return BacktestResponse(
        equity_curve=equity_ts,
        drawdown_curve=drawdown_ts,
        price_series=None,
        signals=signals,
        trades=trades,
        metrics=metrics,
        universe_size=len(tickers),
        trades_count=len(trades),
    )
