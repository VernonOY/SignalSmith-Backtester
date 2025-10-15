"""Utilities to build the data layer for the backtesting dashboard.

This module fetches the current S&P 500 constituency, downloads daily OHLCV
history from Yahoo Finance via ``yfinance`` and stores both long-format and
wide-format tables to disk.  The wide tables follow the mentor's preference:
``open_wide``, ``high_wide``, ``low_wide``, ``close_wide``, ``adjclose_wide``
and ``volume_wide`` – each row is a date and each column (after the first) is
an S&P 500 ticker.

Run the module as a script to execute the full pipeline::

    python data_pipeline.py --output-dir data --start 2005-01-01

Feather files are written to the chosen directory so that the R/Shiny or
Python UI can load them quickly.
"""

from __future__ import annotations

import argparse
import sys
import time
from io import StringIO
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Iterable, List, Optional

import pandas as pd
import yfinance as yf

SP500_WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
DEFAULT_START = "2005-01-01"
DEFAULT_CHUNK = 25


def fetch_sp500_components(
    cache_path: Optional[Path] = None,
    refresh: bool = False,
) -> pd.DataFrame:
    """Scrape the S&P 500 member table and cache the result if requested."""
    if cache_path is not None and cache_path.exists() and not refresh:
        suffix = cache_path.suffix.lower()
        if suffix == ".feather":
            cached = pd.read_feather(cache_path)
        elif suffix in {".parquet", ".pq"}:
            cached = pd.read_parquet(cache_path)
        else:
            cached = pd.read_csv(cache_path)
        if {"sector", "sub_industry"}.issubset(cached.columns):
            return cached
        print("Cached symbol table missing sector metadata; refreshing ...", file=sys.stderr)

    headers = {"User-Agent": "Mozilla/5.0 (compatible; CodexBot/1.0)"}
    response = requests.get(SP500_WIKI_URL, headers=headers, timeout=30)
    response.raise_for_status()
    tables = pd.read_html(StringIO(response.text))
    if not tables:
        raise RuntimeError("Unable to parse S&P 500 table from Wikipedia")
    df = tables[0]
    df = df.rename(
        columns={
            "Symbol": "symbol",
            "Security": "security",
            "GICS Sector": "sector",
            "GICS Sub-Industry": "sub_industry",
        }
    )
    df["symbol"] = df["symbol"].str.replace(".", "-", regex=False).str.upper()
    keep_cols = [col for col in ["symbol", "security", "sector", "sub_industry"] if col in df.columns]
    df = df[keep_cols]

    if cache_path is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        if cache_path.suffix == ".feather":
            df.to_feather(cache_path)
        elif cache_path.suffix in {".parquet", ".pq"}:
            df.to_parquet(cache_path, index=False)
        else:
            df.to_csv(cache_path, index=False)
    return df


def _chunked(items: Iterable[str], size: int) -> Iterable[List[str]]:
    items_list = list(items)
    for i in range(0, len(items_list), size):
        yield items_list[i : i + size]


def fetch_market_caps(symbols: List[str], max_workers: int = 8) -> pd.DataFrame:
    """Fetch approximate market capitalisations using yfinance fast info."""

    def _fetch(sym: str) -> Dict[str, Optional[float]]:
        cap = None
        try:
            ticker = yf.Ticker(sym)
            fast = getattr(ticker, "fast_info", {}) or {}
            cap = fast.get("market_cap")
            if cap is None:
                info = getattr(ticker, "info", {}) or {}
                cap = info.get("marketCap")
        except Exception as exc:  # pragma: no cover - network errors are expected
            print(f"Market cap lookup failed for {sym}: {exc}", file=sys.stderr)
        return {"symbol": sym, "market_cap": cap}

    results: List[Dict[str, Optional[float]]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_fetch, sym): sym for sym in symbols}
        for fut in as_completed(futures):
            results.append(fut.result())
    return pd.DataFrame(results)


def download_ohlcv_history(
    symbols: List[str],
    start: str = DEFAULT_START,
    end: Optional[str] = None,
    chunk_size: int = DEFAULT_CHUNK,
    pause: float = 1.0,
    max_retries: int = 3,
) -> pd.DataFrame:
    """Download daily OHLCV data for all ``symbols`` using ``yfinance``."""
    frames: List[pd.DataFrame] = []
    for chunk_idx, chunk in enumerate(_chunked(symbols, chunk_size), start=1):
        attempt = 0
        while attempt < max_retries:
            try:
                data = yf.download(
                    chunk,
                    start=start,
                    end=end,
                    auto_adjust=False,
                    group_by="ticker",
                    progress=False,
                    threads=True,
                )
            except Exception as exc:  # network hiccup
                attempt += 1
                wait = pause * (2**attempt)
                print(
                    f"Chunk {chunk_idx}: download failed ({exc}); retry {attempt}/{max_retries} in {wait:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue

            if data.empty:
                attempt += 1
                wait = pause * (2**attempt)
                print(
                    f"Chunk {chunk_idx}: received empty frame; retry {attempt}/{max_retries} in {wait:.1f}s",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue

            try:
                stacked = data.stack(level=0, future_stack=True).reset_index()
            except TypeError:
                stacked = data.stack(level=0).reset_index()
            stacked.rename(
                columns={
                    "Date": "date",
                    "Ticker": "symbol",
                    "Open": "open",
                    "High": "high",
                    "Low": "low",
                    "Close": "close",
                    "Adj Close": "adjusted",
                    "Volume": "volume",
                },
                inplace=True,
            )
            stacked["date"] = pd.to_datetime(stacked["date"])
            stacked.sort_values(["symbol", "date"], inplace=True)
            stacked.dropna(subset=["adjusted"], inplace=True)
            frames.append(stacked)
            print(
                f"Chunk {chunk_idx}: downloaded {len(chunk)} tickers, {len(stacked)} rows",
                file=sys.stderr,
            )
            break
        else:
            print(
                f"Chunk {chunk_idx}: giving up after {max_retries} retries",
                file=sys.stderr,
            )
    if not frames:
        raise RuntimeError("No price data downloaded; check ticker list and network access")
    combined = pd.concat(frames, ignore_index=True)
    combined.drop_duplicates(subset=["symbol", "date"], keep="last", inplace=True)
    combined.sort_values(["symbol", "date"], inplace=True)
    return combined


def build_wide_tables(prices_long: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    """Pivot the long-format price table into mentor-preferred wide tables."""
    pivot_cols = {
        "open_wide": "open",
        "high_wide": "high",
        "low_wide": "low",
        "close_wide": "close",
        "adjclose_wide": "adjusted",
        "volume_wide": "volume",
    }
    wide_tables: Dict[str, pd.DataFrame] = {}
    for name, value_col in pivot_cols.items():
        wide = (
            prices_long.pivot(index="date", columns="symbol", values=value_col)
            .sort_index()
            .reset_index()
        )
        wide_tables[name] = wide
    return wide_tables


def run_pipeline(
    output_dir: Path,
    start: str = DEFAULT_START,
    end: Optional[str] = None,
    refresh_symbols: bool = False,
    chunk_size: int = DEFAULT_CHUNK,
    limit: Optional[int] = None,
    skip_market_cap: bool = False,
) -> None:
    """Execute the full data pipeline and persist artifacts to ``output_dir``."""
    output_dir.mkdir(parents=True, exist_ok=True)
    symbols_path = output_dir / "sp500_symbols.feather"
    prices_path = output_dir / "prices_long.feather"

    symbols = fetch_sp500_components(symbols_path, refresh=refresh_symbols)
    print(f"Fetched {len(symbols)} S&P 500 symbols", file=sys.stderr)

    requested = symbols["symbol"].tolist()
    if limit is not None:
        requested = requested[:limit]
        print(f"Limiting download to first {limit} tickers", file=sys.stderr)
    price_df = download_ohlcv_history(
        requested,
        start=start,
        end=end,
        chunk_size=chunk_size,
    )
    downloaded = sorted(price_df["symbol"].unique())
    missing = sorted(set(requested) - set(downloaded))
    if missing:
        preview = ', '.join(missing[:10])
        suffix = '...' if len(missing) > 10 else ''
        print(f"Missing {len(missing)} tickers: {preview}{suffix}", file=sys.stderr)
    print(f"Combined price rows: {len(price_df):,}", file=sys.stderr)
    price_df.to_feather(prices_path)

    wide_tables = build_wide_tables(price_df)
    for name, table in wide_tables.items():
        table.to_feather(output_dir / f"{name}.feather")
        print(f"Wrote {name}.feather", file=sys.stderr)

    metadata = symbols.copy()
    if not skip_market_cap:
        print("Fetching market capitalisations ...", file=sys.stderr)
        market_caps = fetch_market_caps(requested)
        metadata = metadata.merge(market_caps, on="symbol", how="left")
    metadata.to_feather(output_dir / "sp500_metadata.feather")
    print("Wrote sp500_metadata.feather", file=sys.stderr)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build S&P 500 OHLCV data bundle")
    parser.add_argument("--output-dir", default="data", type=Path, help="Directory for feather outputs")
    parser.add_argument("--start", default=DEFAULT_START, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", default=None, help="Optional end date (YYYY-MM-DD)")
    parser.add_argument("--refresh-symbols", action="store_true", help="Force re-scrape of S&P 500 table")
    parser.add_argument("--chunk-size", default=DEFAULT_CHUNK, type=int, help="Ticker batch size for downloads")
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N tickers (debug)")
    parser.add_argument("--skip-market-cap", action="store_true", help="Do not fetch market cap metadata")
    return parser.parse_args(argv)


if __name__ == "__main__":
    args = parse_args()
    run_pipeline(
        output_dir=args.output_dir,
        start=args.start,
        end=args.end,
        refresh_symbols=args.refresh_symbols,
        chunk_size=args.chunk_size,
        limit=args.limit,
        skip_market_cap=args.skip_market_cap,
    )
