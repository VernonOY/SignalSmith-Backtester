from __future__ import annotations

import sys
import pathlib
import platform
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
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


class HorizonResult(BaseModel):
    equity_curve: TimeSeries
    drawdown_curve: TimeSeries
    metrics: Dict[str, float] = Field(default_factory=dict)
    trades_count: int = 0
    ending_equity: float = 0.0
    total_return: float = 0.0
    total_fees: float = 0.0


class BacktestResponse(BaseModel):
    equity_curve: TimeSeries
    drawdown_curve: TimeSeries
    price_series: Optional[TimeSeries] = None
    signals: List[Signal] = Field(default_factory=list)
    trades: List[Trade] = Field(default_factory=list)
    metrics: Dict[str, float] = Field(default_factory=dict)
    histogram: Optional[HistogramPayload] = None
    indicator_statistics: Dict[str, Dict[str, Optional[float]]] = Field(default_factory=dict)
    horizon_results: Dict[int, HorizonResult] = Field(default_factory=dict)
    universe_size: int
    trades_count: int
    initial_capital: float
    ending_equity: float
    total_return: float
    total_fees: float
    hold_days: int


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


def _process_single_horizon(
    horizon: int,
    picks: pd.DataFrame,
    initial_capital: float,
    fee_model: FeeModel,
    stop_loss_pct: Optional[float],
    take_profit_pct: Optional[float],
) -> Tuple[int, HorizonResult, Optional[Any], pd.DataFrame]:
    """Process a single horizon and return results. Used for parallel processing."""
    trade_config = TradeBuilderConfig(
        hold_days=horizon,
        fee_model=fee_model,
        initial_capital=initial_capital,
        stop_loss_pct=stop_loss_pct,
        take_profit_pct=take_profit_pct,
        compound=True,
    )
    execution_result = build_trades_from_picks(picks, trade_config)
    trades_df = execution_result.trades
    equity_series = build_equity_curve(trades_df, initial_capital=initial_capital, column="net_pnl")
    drawdown_series = compute_drawdown(equity_series)
    metrics = compute_performance_metrics(equity_series, drawdown_series)
    ending_value = float(metrics.get("ending_equity", initial_capital))
    total_return_value = float(ending_value / initial_capital - 1.0) if initial_capital else 0.0
    total_fees_value = float(trades_df["fees"].sum()) if not trades_df.empty else 0.0

    def _to_timeseries_local(series: pd.Series) -> TimeSeries:
        if series is None or series.empty:
            return TimeSeries(dates=[], values=[])
        cleaned = series.replace([np.inf, -np.inf], np.nan).dropna()
        if cleaned.empty:
            return TimeSeries(dates=[], values=[])
        cleaned = cleaned.sort_index()
        return TimeSeries(
            dates=[d.strftime("%Y-%m-%d") for d in cleaned.index],
            values=[float(round(val, 6)) for val in cleaned],
        )

    horizon_result = HorizonResult(
        equity_curve=_to_timeseries_local(equity_series),
        drawdown_curve=_to_timeseries_local(drawdown_series),
        metrics={k: float(v) for k, v in metrics.items()},
        trades_count=int(trades_df.shape[0]),
        ending_equity=ending_value,
        total_return=total_return_value,
        total_fees=total_fees_value,
    )

    return horizon, horizon_result, execution_result, trades_df


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
    stop_loss_pct = payload.stop_loss_pct or payload.indicators.get("stop_loss_pct")
    take_profit_pct = payload.take_profit_pct or payload.indicators.get("take_profit_pct")
    expected_horizons = list(range(1, max_horizon + 1))

    def _to_timeseries(series: pd.Series) -> TimeSeries:
        if series is None or series.empty:
            return TimeSeries(dates=[], values=[])
        cleaned = series.replace([np.inf, -np.inf], np.nan).dropna()
        if cleaned.empty:
            return TimeSeries(dates=[], values=[])
        cleaned = cleaned.sort_index()
        return TimeSeries(
            dates=[d.strftime("%Y-%m-%d") for d in cleaned.index],
            values=[float(round(val, 6)) for val in cleaned],
        )

    horizon_results: Dict[int, HorizonResult] = {}
    selected_trades = pd.DataFrame()
    selected_metrics: Dict[str, float] = {}
    selected_equity = pd.Series(dtype=float)
    selected_drawdown = pd.Series(dtype=float)
    selected_execution = None
    ending_equity = float(initial_capital)
    total_return = 0.0

    # Parallel processing of horizons for better performance
    with ThreadPoolExecutor(max_workers=min(len(expected_horizons), 4)) as executor:
        futures = {
            executor.submit(
                _process_single_horizon,
                horizon,
                picks,
                initial_capital,
                fee_model,
                stop_loss_pct,
                take_profit_pct,
            ): horizon
            for horizon in expected_horizons
        }

        for future in as_completed(futures):
            horizon, horizon_result, execution_result, trades_df = future.result()
            horizon_results[horizon] = horizon_result

            if horizon == hold_days:
                selected_execution = execution_result
                selected_trades = trades_df
                selected_metrics = {k: float(v) for k, v in horizon_result.metrics.items()}
                # Rebuild equity/drawdown from trades for consistency
                selected_equity = build_equity_curve(trades_df, initial_capital=initial_capital, column="net_pnl")
                selected_drawdown = compute_drawdown(selected_equity)
                ending_equity = float(horizon_result.ending_equity)
                total_return = float(horizon_result.total_return)

    selected_result = horizon_results.get(hold_days)
    if selected_result is None:
        selected_result = HorizonResult(
            equity_curve=TimeSeries(dates=[], values=[]),
            drawdown_curve=TimeSeries(dates=[], values=[]),
            metrics={},
            trades_count=0,
            ending_equity=float(initial_capital),
            total_return=0.0,
            total_fees=0.0,
        )

    if selected_execution is None:
        selected_execution = build_trades_from_picks(
            picks,
            TradeBuilderConfig(
                hold_days=hold_days,
                fee_model=fee_model,
                initial_capital=initial_capital,
                stop_loss_pct=stop_loss_pct,
                take_profit_pct=take_profit_pct,
                compound=True,
            ),
        )
        selected_trades = selected_execution.trades
        selected_equity = build_equity_curve(selected_trades, initial_capital=initial_capital, column="net_pnl")
        selected_drawdown = compute_drawdown(selected_equity)
        selected_metrics = compute_performance_metrics(selected_equity, selected_drawdown)
        ending_equity = float(selected_metrics.get("ending_equity", initial_capital))
        total_return = float(ending_equity / initial_capital - 1.0) if initial_capital else 0.0
        fallback_total_fees = float(selected_trades["fees"].sum()) if not selected_trades.empty else 0.0
        horizon_results[hold_days] = HorizonResult(
            equity_curve=_to_timeseries(selected_equity),
            drawdown_curve=_to_timeseries(selected_drawdown),
            metrics={k: float(v) for k, v in selected_metrics.items()},
            trades_count=int(selected_trades.shape[0]),
            ending_equity=float(ending_equity),
            total_return=total_return,
            total_fees=fallback_total_fees,
        )

    realised_trades = selected_trades
    warn_if_returns_constant(realised_trades)

    ledger = selected_execution.ledger if selected_execution is not None else pd.DataFrame()
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

    equity_ts = selected_result.equity_curve
    drawdown_ts = selected_result.drawdown_curve
    metrics = dict(selected_result.metrics)
    ending_equity = float(selected_result.ending_equity)
    total_return = float(selected_result.total_return)
    total_fees = float(selected_result.total_fees)
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
    expected_horizons = list(range(1, max_horizon + 1))
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
            observed = {series.horizon for series in series_payload}
            for horizon in expected_horizons:
                if horizon not in observed:
                    series_payload.append(
                        HistogramSeries(
                            horizon=horizon,
                            returns=[],
                            sample_size=0,
                            stats={},
                        )
                    )
            series_payload.sort(key=lambda item: item.horizon)
            requested_width = payload.hist_bin_width or 0.01
            safe_width = float(max(0.0005, min(requested_width, 1.0)))
            histogram_payload = HistogramPayload(
                series=series_payload, bin_width=round(safe_width, 6)
            )

    indicator_stats: Dict[str, Dict[str, Optional[float]]] = {}
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

    if indicator_stats:
        empty_stats = {"mean": None, "median": None, "std": None, "skew": None, "kurt": None}
        for horizon in expected_horizons:
            key = f"fwd_ret_{horizon}d"
            indicator_stats.setdefault(key, empty_stats.copy())

    return BacktestResponse(
        equity_curve=equity_ts,
        drawdown_curve=drawdown_ts,
        price_series=price_ts,
        signals=signals,
        trades=trades,
        metrics=metrics,
        histogram=histogram_payload,
        indicator_statistics=indicator_stats,
        horizon_results=horizon_results,
        universe_size=len(tickers),
        trades_count=len(trades),
        initial_capital=initial_capital,
        ending_equity=ending_equity,
        total_return=total_return,
        total_fees=total_fees,
        hold_days=hold_days,
    )
