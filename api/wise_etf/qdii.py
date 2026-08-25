"""Pure QDII symbol, quote, and valuation rules.

The QDII web/API layer must not know how an upstream provider spells a ticker
or how currency returns are combined.  Keeping those rules here makes replay
tests possible without Redis, HTTP, FastAPI, or a live market.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import math
from typing import Any, Dict, Iterable, Mapping, Optional
from zoneinfo import ZoneInfo


_US_MARKET_IDS = {"74", "105", "106", "107"}
_MARKET_SUFFIX = {
    "0": ".SZ",
    "1": ".SS",
    "116": ".HK",
}

# Eastmoney occasionally omits/changes the numeric market id.  These securities
# were previously misclassified as Taiwan or US tickers in production.
_SYMBOL_OVERRIDES = {
    "285A": "285A.T",      # Kioxia Holdings
    "6857": "6857.T",      # Advantest
    "6981": "6981.T",      # Murata Manufacturing
}

_CURRENCY_BY_SUFFIX = {
    ".HK": "HKD",
    ".SS": "CNY",
    ".SZ": "CNY",
    ".TW": "TWD",
    ".TWO": "TWD",
    ".KS": "KRW",
    ".KQ": "KRW",
    ".T": "JPY",
    ".L": "GBP",
    ".PA": "EUR",
    ".DE": "EUR",
}


def classify_qdii_market_session(now: Optional[datetime] = None) -> str:
    """Classify the display session from exchange-local clocks.

    Yahoo's ``PREPRE`` state can begin during the US overnight gap and must not
    be treated as official pre-market.  The clock is therefore authoritative;
    provider state is only used later to prove that a live quote exists.
    """

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    china = current.astimezone(ZoneInfo("Asia/Shanghai"))
    new_york = current.astimezone(ZoneInfo("America/New_York"))
    china_hour = china.hour + china.minute / 60
    ny_hour = new_york.hour + new_york.minute / 60

    # During the China business day the useful US reference is the completed
    # close.  Asian holdings may continue to update, but this is not US premarket.
    if china.weekday() < 5 and 8 <= china_hour < 16:
        return "a_share"
    if new_york.weekday() >= 5:
        return "weekend"
    if 4 <= ny_hour < 9.5:
        return "pre_market"
    if 9.5 <= ny_hour < 16:
        return "us_open"
    if 16 <= ny_hour < 20:
        return "post_market"
    return "closed"


def _finite_number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def canonicalize_symbol(raw_symbol: Any, market_id: Any = None) -> str:
    """Return one canonical Yahoo-style symbol without guessing known markets.

    Hong Kong tickers retain the four-digit Yahoo code (for example ``0522.HK``)
    and the known Japanese securities above never fall through to the old
    "every four digit code is Taiwan" heuristic.
    """

    raw = str(raw_symbol or "").strip().upper()
    if not raw:
        return ""
    if raw in _SYMBOL_OVERRIDES:
        return _SYMBOL_OVERRIDES[raw]
    if "." in raw:
        return raw

    market = str(market_id or "").strip()
    if market in _US_MARKET_IDS:
        return raw
    if market == "116":
        try:
            return f"{int(raw):04d}.HK"
        except ValueError:
            return f"{raw}.HK"
    if market in _MARKET_SUFFIX:
        return f"{raw}{_MARKET_SUFFIX[market]}"

    if raw.isdigit():
        if len(raw) == 6:
            if raw.startswith("6"):
                return f"{raw}.SS"
            # A-share rows normally carry market_id=0.  Without that provider
            # metadata a six-digit 0-prefixed code is more likely a Korean
            # holding (for example Samsung 005930) than a Shenzhen security.
            if raw.startswith("3"):
                return f"{raw}.SZ"
            return f"{raw}.KS"
        if len(raw) == 5:
            return f"{int(raw):04d}.HK"
        if len(raw) == 4:
            return f"{raw}.TW"
    return raw


def currency_for_symbol(symbol: str, provider_currency: Any = None) -> str:
    """Resolve the trading currency, preferring the provider's explicit field."""

    explicit = str(provider_currency or "").strip().upper()
    if explicit:
        return explicit
    upper = str(symbol or "").upper()
    for suffix, currency in _CURRENCY_BY_SUFFIX.items():
        if upper.endswith(suffix):
            return currency
    return "USD"


def fx_pair_for_currency(currency: str) -> Optional[str]:
    currency = str(currency or "").upper()
    if currency == "CNY":
        return None
    return f"{currency}CNY=X" if currency else None


def combine_percent_returns(first: Any, second: Any) -> Optional[float]:
    """Compound two percentage-point returns rather than adding them."""

    left = _finite_number(first)
    right = _finite_number(second)
    if left is None or right is None:
        return None
    return ((1.0 + left / 100.0) * (1.0 + right / 100.0) - 1.0) * 100.0


def position_return_cny(asset_return_pct: Any, fx_return_pct: Any) -> Optional[float]:
    """Convert a local-currency security return into a CNY investor return."""

    return combine_percent_returns(asset_return_pct, fx_return_pct)


def _timestamp_iso(value: Any) -> Optional[str]:
    timestamp = _finite_number(value)
    if timestamp is None or timestamp <= 0:
        return None
    try:
        return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="seconds")
    except (OSError, OverflowError, ValueError):
        return None


def _market_date(value: Any, timezone_name: Any) -> Optional[str]:
    timestamp = _finite_number(value)
    if timestamp is None or timestamp <= 0:
        return None
    try:
        tz = ZoneInfo(str(timezone_name or "UTC"))
        return datetime.fromtimestamp(timestamp, timezone.utc).astimezone(tz).date().isoformat()
    except (KeyError, OSError, OverflowError, ValueError):
        return datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()


def normalize_yahoo_quote(row: Mapping[str, Any], fetched_at: Optional[str] = None) -> Optional[dict]:
    """Normalize one Yahoo batch-quote row with explicit session timestamps."""

    symbol = canonicalize_symbol(row.get("symbol"))
    price = _finite_number(row.get("regularMarketPrice"))
    previous_close = _finite_number(row.get("regularMarketPreviousClose"))
    regular_return = _finite_number(row.get("regularMarketChangePercent"))
    regular_time = row.get("regularMarketTime")
    if not symbol or price is None or price <= 0 or regular_return is None or not _timestamp_iso(regular_time):
        return None

    market_state = str(row.get("marketState") or "UNKNOWN").upper()
    extended_return = None
    extended_price = None
    extended_time = None
    extended_session = None
    if market_state in {"PRE", "PREPRE"}:
        extended_return = _finite_number(row.get("preMarketChangePercent"))
        extended_price = _finite_number(row.get("preMarketPrice"))
        extended_time = row.get("preMarketTime")
        extended_session = "pre"
    elif market_state in {"POST", "POSTPOST", "CLOSED"}:
        extended_return = _finite_number(row.get("postMarketChangePercent"))
        extended_price = _finite_number(row.get("postMarketPrice"))
        extended_time = row.get("postMarketTime")
        extended_session = "post" if extended_return is not None else None

    # During regular trading the current return is already measured from the
    # previous close.  Post-market is relative to the regular close and must be
    # compounded to preserve a previous-close-to-now return.
    if market_state == "REGULAR":
        live_return = regular_return
        live_price = price
        live_time = regular_time
        live_session = "regular"
    elif extended_return is not None and _timestamp_iso(extended_time):
        live_return = (
            extended_return
            if extended_session == "pre"
            else combine_percent_returns(regular_return, extended_return)
        )
        live_price = extended_price if extended_price is not None and extended_price > 0 else price
        live_time = extended_time
        live_session = extended_session
    else:
        live_return = regular_return
        live_price = price
        live_time = regular_time
        live_session = "close"

    timezone_name = row.get("exchangeTimezoneName") or "UTC"
    return {
        "symbol": symbol,
        "exchange": row.get("exchange"),
        "exchange_timezone": timezone_name,
        "currency": currency_for_symbol(symbol, row.get("currency")),
        "market_state": market_state,
        "regular_price": round(price, 8),
        "previous_close": round(previous_close, 8) if previous_close is not None else None,
        "regular_return_pct": round(regular_return, 6),
        "regular_as_of": _timestamp_iso(regular_time),
        "regular_market_date": _market_date(regular_time, timezone_name),
        "extended_price": round(extended_price, 8) if extended_price is not None and extended_price > 0 else None,
        "extended_return_pct": round(extended_return, 6) if extended_return is not None else None,
        "extended_as_of": _timestamp_iso(extended_time),
        "live_price": round(live_price, 8) if live_price is not None and live_price > 0 else None,
        "live_return_pct": round(live_return, 6) if live_return is not None else None,
        "live_as_of": _timestamp_iso(live_time),
        "live_session": live_session,
        "source": "yahoo_batch_quote",
        "fetched_at": fetched_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_status": "fresh",
    }


def quote_observation_is_recent(
    quote: Mapping[str, Any],
    *,
    now: Optional[datetime] = None,
    max_age_days: int = 4,
) -> bool:
    """Reject undated, future, or obviously old market observations.

    A four-calendar-day allowance keeps Friday closes valid through Monday
    pre-market, while preventing an upstream response from silently reviving a
    week-old close as a new QDII snapshot.  Exchange holidays can therefore
    degrade the snapshot to ``partial``; that is safer than claiming freshness.
    """

    raw_date = str(quote.get("regular_market_date") or "").strip()
    if not raw_date:
        return False
    try:
        observed = date.fromisoformat(raw_date)
        timezone_name = str(quote.get("exchange_timezone") or "UTC")
        current = now or datetime.now(timezone.utc)
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        today = current.astimezone(ZoneInfo(timezone_name)).date()
    except (KeyError, TypeError, ValueError):
        return False
    age = (today - observed).days
    return 0 <= age <= max(0, max_age_days)


def compute_fund_valuation(
    holdings: Iterable[Mapping[str, Any]],
    quotes: Mapping[str, Mapping[str, Any]],
    fx_quotes: Mapping[str, Mapping[str, Any]],
    *,
    return_field: str = "regular_return_pct",
) -> dict:
    """Calculate a non-normalized, multi-currency top-holdings contribution.

    Missing holdings remain missing; their weights are never scaled to 100%.
    A non-CNY position is priced only when its matching CNY FX return exists.
    """

    disclosed_weight = 0.0
    priced_weight = 0.0
    fresh_weight = 0.0
    equity_contribution = 0.0
    fx_contribution = 0.0
    total_contribution = 0.0
    enriched = []

    for holding in holdings or ():
        weight = _finite_number(holding.get("weight"))
        symbol = canonicalize_symbol(holding.get("symbol"), holding.get("market_id"))
        if not symbol or weight is None or not 0 < weight <= 100:
            continue
        disclosed_weight += weight
        quote = quotes.get(symbol) or {}
        asset_return = _finite_number(quote.get(return_field))
        price_field = "live_price" if return_field == "live_return_pct" else "regular_price"
        price_as_of_field = "live_as_of" if return_field == "live_return_pct" else "regular_as_of"
        asset_price = _finite_number(quote.get(price_field))
        currency = currency_for_symbol(symbol, quote.get("currency"))
        fx_pair = fx_pair_for_currency(currency)
        fx_return = 0.0 if fx_pair is None else _finite_number((fx_quotes.get(fx_pair) or {}).get(return_field))
        cny_return = position_return_cny(asset_return, fx_return)

        status = "missing"
        if cny_return is not None:
            priced_weight += weight
            if quote.get("data_status") == "fresh" and (
                fx_pair is None or (fx_quotes.get(fx_pair) or {}).get("data_status") == "fresh"
            ):
                fresh_weight += weight
                status = "fresh"
            else:
                status = "stale"
            equity_part = weight / 100.0 * asset_return
            total_part = weight / 100.0 * cny_return
            equity_contribution += equity_part
            fx_contribution += total_part - equity_part
            total_contribution += total_part

        enriched.append({
            **dict(holding),
            "symbol": symbol,
            "currency": currency,
            "asset_price": round(asset_price, 8) if asset_price is not None and asset_price > 0 else None,
            "price_as_of": quote.get(price_as_of_field),
            "asset_return_pct": round(asset_return, 4) if asset_return is not None else None,
            "fx_return_pct": round(fx_return, 4) if fx_return is not None else None,
            "cny_return_pct": round(cny_return, 4) if cny_return is not None else None,
            "quote_status": status,
        })

    disclosed = round(min(disclosed_weight, 100.0), 2)
    priced = round(min(priced_weight, disclosed_weight, 100.0), 2)
    fresh = round(min(fresh_weight, priced_weight, 100.0), 2)
    if priced <= 0:
        grade = "unavailable"
    elif fresh < priced or priced < disclosed:
        grade = "partial"
    elif priced >= 60:
        grade = "high"
    elif priced >= 35:
        grade = "medium"
    else:
        grade = "low"

    return {
        "estimated_return_pct": round(total_contribution, 4) if priced > 0 else None,
        "equity_contribution_pct": round(equity_contribution, 4) if priced > 0 else None,
        "fx_contribution_pct": round(fx_contribution, 4) if priced > 0 else None,
        "coverage": {
            "disclosed_weight": disclosed,
            "priced_weight": priced,
            "fresh_weight": fresh,
        },
        "quality_grade": grade,
        "holdings": enriched,
    }
