"""Pure normalization and calculation rules for fund and ETF data.

All functions are side-effect free.  Invalid or incomplete upstream values are
represented as ``None`` rather than a numeric sentinel such as zero.
"""

import math
import re
from datetime import date, datetime, timedelta, timezone
from numbers import Number
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple, TypeVar, Union

from .models import NavPoint, PurchaseSnapshot, PurchaseStatus


T = TypeVar("T")
SortKey = Union[str, Callable[[T], Any]]

_MISSING_TEXT = {
    "",
    "--",
    "-",
    "n/a",
    "na",
    "nan",
    "none",
    "null",
    "未知",
    "暂无",
}
_NUMBER_RE = re.compile(
    r"^(?P<number>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"
    r"(?P<unit>万亿|千|万|亿)?$"
)
_UNIT_MULTIPLIER = {None: 1.0, "千": 1_000.0, "万": 10_000.0, "亿": 100_000_000.0, "万亿": 1_000_000_000_000.0}

_SUSPENDED_WORDS = ("暂停申购", "暂停认购", "停止申购", "关闭申购", "不可申购", "禁止申购")
_LIMITED_WORDS = ("暂停大额申购", "暂停大额", "限大额", "限制大额", "限额", "大额申购限制")
_OPEN_WORDS = ("开放申购", "正常申购", "可申购", "开放", "场内交易")


def parse_number(value: Any) -> Optional[float]:
    """Parse a feed scalar into a finite float.

    Thousands separators, common currency/percentage decorations, accounting
    parentheses, and Chinese amount units are accepted.  Percentage text keeps
    its displayed percentage-point scale: ``"12.5%"`` becomes ``12.5``.
    Booleans and non-finite numbers are rejected.
    """

    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, Number):
        number = float(value)
        return number if math.isfinite(number) else None

    if not isinstance(value, str):
        return None

    text = value.strip().replace("\u00a0", "").replace(" ", "")
    if text.casefold() in _MISSING_TEXT:
        return None

    negative_parentheses = text.startswith("(") and text.endswith(")")
    if negative_parentheses:
        text = text[1:-1]

    text = text.replace(",", "").replace("，", "")
    text = text.lstrip("¥￥$")
    if text.endswith(("%", "％")):
        text = text[:-1]
    if text.endswith("元"):
        text = text[:-1]

    match = _NUMBER_RE.fullmatch(text)
    if not match:
        return None

    number = float(match.group("number")) * _UNIT_MULTIPLIER[match.group("unit")]
    if negative_parentheses:
        number = -number
    return number if math.isfinite(number) else None


def normalize_purchase_status(raw_status: Any, daily_limit: Any = None) -> PurchaseStatus:
    """Return the canonical purchase status, with suspension taking priority."""

    text = "" if raw_status is None else str(raw_status).strip()
    parsed_limit = parse_number(daily_limit)
    has_limit = parsed_limit is not None and parsed_limit > 0

    if any(word in text for word in _SUSPENDED_WORDS):
        return "suspended"
    if any(word in text for word in _LIMITED_WORDS) or has_limit:
        return "limited"
    if any(word in text for word in _OPEN_WORDS):
        return "open"
    return "unknown"


def normalize_purchase(raw_status: Any, daily_limit: Any = None) -> PurchaseSnapshot:
    """Normalize purchase status and its actionable daily CNY limit."""

    status = normalize_purchase_status(raw_status, daily_limit)
    parsed_limit = parse_number(daily_limit)
    actionable_limit = parsed_limit if status == "limited" and parsed_limit is not None and parsed_limit > 0 else None
    raw = None if raw_status is None else str(raw_status).strip() or None
    return PurchaseSnapshot(status=status, daily_limit_cny=actionable_limit, raw_status=raw)


def _timestamp_ms(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)

    if isinstance(value, date):
        dt = datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)

    if isinstance(value, str):
        text = value.strip()
        numeric = parse_number(text)
        if numeric is not None:
            value = numeric
        else:
            try:
                dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return None
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)

    if isinstance(value, Number):
        number = float(value)
        if not math.isfinite(number):
            return None
        # Current Unix seconds are ~1e9 and milliseconds are ~1e12.
        return int(number * 1000) if abs(number) < 100_000_000_000 else int(number)

    return None


def _mapping_value(mapping: Mapping[str, Any], keys: Sequence[str]) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def normalize_nav_points(points: Iterable[Any]) -> List[NavPoint]:
    """Normalize Eastmoney-style cumulative NAV points and discard bad rows."""

    normalized: List[NavPoint] = []
    for point in points or ():
        timestamp: Any = None
        cumulative_nav: Any = None

        if isinstance(point, Mapping):
            timestamp = _mapping_value(point, ("timestamp_ms", "timestamp", "date", "x"))
            cumulative_nav = _mapping_value(point, ("cumulative_nav", "nav", "value", "y"))
        elif isinstance(point, Sequence) and not isinstance(point, (str, bytes)) and len(point) >= 2:
            timestamp, cumulative_nav = point[0], point[1]
        else:
            continue

        timestamp_ms = _timestamp_ms(timestamp)
        nav = parse_number(cumulative_nav)
        if timestamp_ms is None or nav is None or nav <= 0:
            continue
        normalized.append(NavPoint(timestamp_ms=timestamp_ms, cumulative_nav=nav))

    return sorted(normalized)


def _year_start_ms(year: int) -> int:
    return int(datetime(year, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)


def calendar_year_return(points: Iterable[Any], year: int, digits: int = 2) -> Optional[float]:
    """Calculate a calendar-year return from cumulative NAV.

    The baseline is the final valid cumulative NAV observation in ``year - 1``;
    the endpoint is the final valid observation in ``year``.  The first NAV in
    the target year is *not* used as the baseline.
    """

    normalized = normalize_nav_points(points)
    previous_start = _year_start_ms(year - 1)
    target_start = _year_start_ms(year)
    target_end = _year_start_ms(year + 1)

    previous = [point for point in normalized if previous_start <= point.timestamp_ms < target_start]
    target = [point for point in normalized if target_start <= point.timestamp_ms < target_end]
    if not previous or not target:
        return None

    baseline = previous[-1].cumulative_nav
    endpoint = target[-1].cumulative_nav
    if baseline <= 0:
        return None
    return round((endpoint / baseline - 1.0) * 100.0, digits)


def rolling_nav_return(
    points: Iterable[Any],
    *,
    days: int = 365,
    tolerance_days: int = 14,
    digits: int = 2,
) -> Optional[float]:
    """Calculate a trailing return from cumulative NAV observations.

    The endpoint is the latest valid point.  The baseline is the last valid
    point on or before ``endpoint - days`` and must be within ``tolerance_days``
    of that target, so a short-history fund is never mistaken for a 1-year
    sample.
    """

    normalized = normalize_nav_points(points)
    if len(normalized) < 2 or days <= 0 or tolerance_days < 0:
        return None
    endpoint = normalized[-1]
    target_ms = endpoint.timestamp_ms - int(timedelta(days=days).total_seconds() * 1000)
    candidates = [point for point in normalized[:-1] if point.timestamp_ms <= target_ms]
    if not candidates:
        return None
    baseline = candidates[-1]
    tolerance_ms = int(timedelta(days=tolerance_days).total_seconds() * 1000)
    if target_ms - baseline.timestamp_ms > tolerance_ms or baseline.cumulative_nav <= 0:
        return None
    return round((endpoint.cumulative_nav / baseline.cumulative_nav - 1.0) * 100.0, digits)


def extract_rolling_1y(
    basic_information: Optional[Mapping[str, Any]] = None,
    period_increase: Optional[Iterable[Mapping[str, Any]]] = None,
) -> Optional[float]:
    """Extract the rolling one-year return, preferring BasicInformation.

    Eastmoney exposes this as ``SYL_1N`` in BasicInformation and as the ``syl``
    value of the ``title == '1N'`` row in PeriodIncrease.
    """

    if isinstance(basic_information, Mapping):
        value = parse_number(basic_information.get("SYL_1N"))
        if value is not None:
            return value

    for row in period_increase or ():
        if not isinstance(row, Mapping):
            continue
        title = str(row.get("title", row.get("TITLE", ""))).strip().upper()
        if title in {"1N", "近1年", "近一年"}:
            value = parse_number(row.get("syl", row.get("SYL")))
            if value is not None:
                return value
    return None


def calculate_etf_premium(market_price: Any, nav: Any, digits: int = 2) -> Optional[float]:
    """Return ETF premium percentage, or ``None`` when either side is absent."""

    price_value = parse_number(market_price)
    nav_value = parse_number(nav)
    if price_value is None or nav_value is None or price_value <= 0 or nav_value <= 0:
        return None
    return round((price_value / nav_value - 1.0) * 100.0, digits)


def _sort_value(value: Any) -> Tuple[int, Any]:
    numeric = parse_number(value)
    if numeric is not None:
        return 0, numeric
    if isinstance(value, str):
        return 1, value.casefold()
    return 2, repr(value)


def _is_sort_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, Number) and not isinstance(value, bool):
        return not math.isfinite(float(value))
    if isinstance(value, str):
        return value.strip().casefold() in _MISSING_TEXT
    return False


def safe_sort(records: Iterable[T], key: SortKey[T], reverse: bool = False) -> List[T]:
    """Return a stable sort with missing/invalid values always placed last."""

    getter: Callable[[T], Any]
    if callable(key):
        getter = key
    else:
        getter = lambda record: record.get(key) if isinstance(record, Mapping) else getattr(record, key, None)

    present: List[Tuple[T, Any]] = []
    missing: List[T] = []
    for record in records:
        try:
            value = getter(record)
        except (KeyError, TypeError, AttributeError, ValueError):
            value = None
        if _is_sort_missing(value):
            missing.append(record)
        else:
            present.append((record, value))

    present.sort(key=lambda pair: _sort_value(pair[1]), reverse=reverse)
    return [record for record, _ in present] + missing


def merge_last_known_good(
    previous: Optional[Mapping[str, Any]],
    incoming: Optional[Mapping[str, Any]],
    failed_fields: Iterable[str] = (),
) -> Dict[str, Any]:
    """Merge an update field-by-field without replacing good values on failure.

    ``None`` represents an unsuccessful field fetch and is ignored.  Falsy but
    valid values such as ``0`` and ``False`` are retained.  Nested mappings are
    merged recursively.  ``failed_fields`` accepts top-level or dotted paths.
    """

    result: Dict[str, Any] = dict(previous or {})
    failures: Set[str] = set(failed_fields)

    for field, value in (incoming or {}).items():
        if field in failures or value is None:
            continue

        child_failures = {
            path[len(field) + 1 :]
            for path in failures
            if path.startswith(field + ".") and len(path) > len(field) + 1
        }
        old_value = result.get(field)
        if isinstance(value, Mapping) and isinstance(old_value, Mapping):
            result[field] = merge_last_known_good(old_value, value, child_failures)
        elif isinstance(value, Mapping):
            result[field] = merge_last_known_good({}, value, child_failures)
        else:
            result[field] = value

    return result


# Readable aliases for call sites that use domain-specific terminology.
etf_premium = calculate_etf_premium
rolling_one_year_return = extract_rolling_1y
merge_lkg = merge_last_known_good
