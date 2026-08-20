"""Pure market-data normalization helpers.

This module deliberately performs no network I/O.  Callers fetch a Yahoo
Finance chart response elsewhere and pass the decoded JSON object to
``normalize_yahoo_monthly_returns``.

Monthly returns use unadjusted index closes (price return, USD):

    current calendar month-end close / prior calendar month-end close - 1

The returned ``months`` array always contains the requested number of complete
calendar months.  A missing calendar month is represented explicitly with an
``unavailable`` row; the normalizer never bridges across the gap.  The current
month is returned separately as MTD.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Tuple, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


YAHOO_CHART_SOURCE = "Yahoo Finance chart"
FIELD_STATUSES = frozenset({"ok", "partial", "stale", "unavailable", "error"})

_INDEX_ALIASES: Dict[str, Dict[str, str]] = {
    "SPX": {"index": "SPX", "symbol": "^GSPC", "name": "S&P 500"},
    "^GSPC": {"index": "SPX", "symbol": "^GSPC", "name": "S&P 500"},
    "GSPC": {"index": "SPX", "symbol": "^GSPC", "name": "S&P 500"},
    "S&P500": {"index": "SPX", "symbol": "^GSPC", "name": "S&P 500"},
    "S&P 500": {"index": "SPX", "symbol": "^GSPC", "name": "S&P 500"},
    "NDX": {"index": "NDX", "symbol": "^NDX", "name": "Nasdaq-100"},
    "^NDX": {"index": "NDX", "symbol": "^NDX", "name": "Nasdaq-100"},
    "NASDAQ100": {"index": "NDX", "symbol": "^NDX", "name": "Nasdaq-100"},
    "NASDAQ-100": {"index": "NDX", "symbol": "^NDX", "name": "Nasdaq-100"},
}

AsOf = Optional[Union[str, date, datetime]]


def _serialize_as_of(value: AsOf) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ValueError("as_of must not be an empty string")
        return stripped
    raise TypeError("as_of must be a date, datetime, string, or None")


def field_envelope(
    value: Any,
    *,
    as_of: AsOf,
    source: str,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """Wrap a PE, VIX, return, or other scalar in a common field contract.

    ``status`` is inferred as ``ok`` for a present value and ``unavailable``
    for ``None``.  Explicit healthy statuses cannot carry a null value, which
    prevents a UI from treating a missing observation as live data.
    """

    if not isinstance(source, str) or not source.strip():
        raise ValueError("source must be a non-empty string")

    resolved_status = status or ("unavailable" if value is None else "ok")
    if resolved_status not in FIELD_STATUSES:
        allowed = ", ".join(sorted(FIELD_STATUSES))
        raise ValueError(f"unsupported status {resolved_status!r}; expected one of {allowed}")
    serialized_as_of = _serialize_as_of(as_of)
    if resolved_status in {"ok", "partial", "stale"}:
        if value is None:
            raise ValueError(f"status {resolved_status!r} requires a non-null value")
        if serialized_as_of is None:
            raise ValueError(f"status {resolved_status!r} requires as_of")

    return {
        "value": value,
        "as_of": serialized_as_of,
        "source": source.strip(),
        "status": resolved_status,
    }


def _resolve_index(index: str) -> Dict[str, str]:
    if not isinstance(index, str) or not index.strip():
        raise ValueError("index must be SPX/^GSPC or NDX/^NDX")
    key = index.strip().upper()
    try:
        return _INDEX_ALIASES[key]
    except KeyError as exc:
        raise ValueError(f"unsupported index {index!r}; use SPX or NDX") from exc


def _extract_chart_result(payload: Mapping[str, Any]) -> Tuple[Optional[Mapping[str, Any]], Optional[str]]:
    chart = payload.get("chart") if isinstance(payload, Mapping) else None
    if not isinstance(chart, Mapping):
        return None, "Yahoo payload has no chart object"

    chart_error = chart.get("error")
    if chart_error:
        if isinstance(chart_error, Mapping):
            description = chart_error.get("description") or chart_error.get("code")
            return None, str(description or chart_error)
        return None, str(chart_error)

    results = chart.get("result")
    if not isinstance(results, list) or not results or not isinstance(results[0], Mapping):
        return None, "Yahoo payload has no chart result"
    return results[0], None


def _exchange_timezone(meta: Mapping[str, Any]) -> Tuple[timezone, str]:
    name = meta.get("exchangeTimezoneName") if isinstance(meta, Mapping) else None
    if isinstance(name, str) and name:
        try:
            return ZoneInfo(name), name
        except ZoneInfoNotFoundError:
            pass
    return timezone.utc, "UTC"


def _reference_day(value: AsOf, tz: timezone) -> date:
    if value is None:
        return datetime.now(tz).date()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=tz).date()
        return value.astimezone(tz).date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValueError("reference_date must not be empty")
        try:
            return date.fromisoformat(text[:10])
        except ValueError as exc:
            raise ValueError("reference_date must start with YYYY-MM-DD") from exc
    raise TypeError("reference_date must be a date, datetime, string, or None")


def _timestamp_date(raw_timestamp: Any, tz: timezone) -> Optional[date]:
    if isinstance(raw_timestamp, bool) or not isinstance(raw_timestamp, (int, float)):
        return None
    timestamp = float(raw_timestamp)
    if not math.isfinite(timestamp):
        return None
    # Yahoo chart timestamps are seconds.  Accept milliseconds defensively.
    if abs(timestamp) >= 100_000_000_000:
        timestamp /= 1000.0
    try:
        return datetime.fromtimestamp(timestamp, timezone.utc).astimezone(tz).date()
    except (OverflowError, OSError, ValueError):
        return None


def _valid_close(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    close = float(value)
    if not math.isfinite(close) or close <= 0:
        return None
    return close


def _daily_closes(result: Mapping[str, Any], tz: timezone, through: date) -> List[Tuple[date, float]]:
    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    if not isinstance(timestamps, list) or not isinstance(indicators, Mapping):
        return []

    quote_series = indicators.get("quote")
    if not isinstance(quote_series, list) or not quote_series or not isinstance(quote_series[0], Mapping):
        return []
    closes = quote_series[0].get("close")
    if not isinstance(closes, list):
        return []

    by_day: Dict[date, float] = {}
    for raw_timestamp, raw_close in zip(timestamps, closes):
        day = _timestamp_date(raw_timestamp, tz)
        close = _valid_close(raw_close)
        if day is None or close is None or day > through:
            continue
        # If duplicate daily observations are present, the later array entry
        # wins.  Yahoo normally provides one observation per trading day.
        by_day[day] = close
    return sorted(by_day.items())


def _add_months(month_start: date, delta: int) -> date:
    ordinal = month_start.year * 12 + month_start.month - 1 + delta
    year, zero_based_month = divmod(ordinal, 12)
    return date(year, zero_based_month + 1, 1)


def _month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def _month_end_closes(closes: List[Tuple[date, float]]) -> Dict[str, Tuple[date, float]]:
    result: Dict[str, Tuple[date, float]] = {}
    for day, close in closes:
        key = _month_key(day)
        previous = result.get(key)
        if previous is None or day >= previous[0]:
            result[key] = (day, close)
    return result


def _return_pct(base: float, end: float) -> float:
    return round((end / base - 1.0) * 100.0, 4)


def _return_row(
    *,
    month: date,
    base_point: Optional[Tuple[date, float]],
    end_point: Optional[Tuple[date, float]],
    source: str,
    is_partial: bool,
) -> Dict[str, Any]:
    value = None
    if base_point is not None and end_point is not None:
        value = _return_pct(base_point[1], end_point[1])

    if value is None:
        status = "unavailable"
    else:
        status = "partial" if is_partial else "ok"

    row = {
        "month": _month_key(month),
        **field_envelope(
            value,
            as_of=end_point[0] if end_point is not None else None,
            source=source,
            status=status,
        ),
        "base_date": base_point[0].isoformat() if base_point is not None else None,
        "end_date": end_point[0].isoformat() if end_point is not None else None,
        "return_type": "price",
        "is_partial": is_partial,
    }
    return row


def normalize_yahoo_monthly_returns(
    payload: Mapping[str, Any],
    index: str,
    *,
    reference_date: AsOf = None,
    months: int = 12,
    source: str = YAHOO_CHART_SOURCE,
) -> Dict[str, Any]:
    """Normalize Yahoo chart JSON into complete monthly returns plus MTD.

    ``reference_date`` determines which calendar month is current.  The
    ``months`` array covers the preceding complete calendar months, oldest
    first.  For example, a reference date in August 2026 yields August 2025
    through July 2026.  At least 13 monthly closes are therefore required to
    calculate all 12 returns.
    """

    if not isinstance(months, int) or isinstance(months, bool) or months <= 0:
        raise ValueError("months must be a positive integer")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("source must be a non-empty string")

    spec = _resolve_index(index)
    result, payload_error = _extract_chart_result(payload)
    meta: Mapping[str, Any] = result.get("meta", {}) if isinstance(result, Mapping) else {}
    if not isinstance(meta, Mapping):
        meta = {}
    tz, timezone_name = _exchange_timezone(meta)
    ref_day = _reference_day(reference_date, tz)
    current_month = date(ref_day.year, ref_day.month, 1)

    symbol_error: Optional[str] = None
    payload_symbol = meta.get("symbol")
    if isinstance(payload_symbol, str) and payload_symbol and payload_symbol.upper() != spec["symbol"]:
        symbol_error = f"Yahoo payload symbol {payload_symbol!r} does not match {spec['symbol']!r}"

    closes = _daily_closes(result, tz, ref_day) if result is not None and symbol_error is None else []
    month_ends = _month_end_closes(closes)

    complete_rows: List[Dict[str, Any]] = []
    for offset in range(months, 0, -1):
        target_month = _add_months(current_month, -offset)
        base_month = _add_months(target_month, -1)
        complete_rows.append(
            _return_row(
                month=target_month,
                base_point=month_ends.get(_month_key(base_month)),
                end_point=month_ends.get(_month_key(target_month)),
                source=source,
                is_partial=False,
            )
        )

    prior_month = _add_months(current_month, -1)
    mtd = _return_row(
        month=current_month,
        base_point=month_ends.get(_month_key(prior_month)),
        end_point=month_ends.get(_month_key(current_month)),
        source=source,
        is_partial=True,
    )

    available = sum(1 for row in complete_rows if row["status"] == "ok")
    error = symbol_error or payload_error
    if error:
        status = "error"
    elif available == months:
        status = "ok"
    elif available:
        status = "partial"
    else:
        status = "unavailable"

    latest_day = closes[-1][0] if closes else None
    return {
        "index": spec["index"],
        "name": spec["name"],
        "symbol": spec["symbol"],
        "return_type": "price",
        "currency": str(meta.get("currency") or "USD"),
        "timezone": timezone_name,
        "source": source.strip(),
        "as_of": latest_day.isoformat() if latest_day is not None else None,
        "status": status,
        "error": error,
        "requested_months": months,
        "available_months": available,
        "months": complete_rows,
        "mtd": mtd,
    }


__all__ = [
    "FIELD_STATUSES",
    "YAHOO_CHART_SOURCE",
    "field_envelope",
    "normalize_yahoo_monthly_returns",
]
