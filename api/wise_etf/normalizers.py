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

AGENCY_SOURCE = "eastmoney_basic"
AGENCY_SOURCE_LABEL = "东方财富基金接口"
AGENCY_CHANNEL_LABEL = "代销 / 平台展示"
AGENCY_CALIBER_NOTE = (
    "该数字来自东方财富基金接口，更接近代销或平台展示，不是全部渠道，"
    "尤其不能当成基金公司直销额度。额度可能滞后，下单前请以基金公告和实际购买渠道为准。"
)


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


_CHINA_TZ = timezone(timedelta(hours=8))
OFFICIAL_NAV_PREMIUM_BASIS = "market_close_vs_latest_published_nav"
IOPV_PREMIUM_BASIS = "market_price_vs_iopv"


def china_calendar_date(value: Any) -> Optional[str]:
    """Return an Asia/Shanghai calendar date (YYYY-MM-DD), or ``None``."""

    if value is None or isinstance(value, bool):
        return None

    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=_CHINA_TZ)
        return dt.astimezone(_CHINA_TZ).date().isoformat()

    if isinstance(value, date):
        return value.isoformat()

    if not isinstance(value, str) or not value.strip():
        return None

    text = value.strip()
    try:
        if "T" in text or text.endswith("Z"):
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_CHINA_TZ)
            return parsed.astimezone(_CHINA_TZ).date().isoformat()
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return None


def classify_etf_premium(
    market_price: Any,
    reference_value: Any,
    quote_as_of: Any,
    reference_as_of: Any,
    *,
    digits: int = 2,
    basis: str = OFFICIAL_NAV_PREMIUM_BASIS,
) -> Dict[str, Any]:
    """Classify an official-NAV or IOPV premium by China calendar alignment.

    A number is only ``fresh`` and alertable when both sides fall on the same
    Asia/Shanghai date.  Misaligned dates may still return the number, but the
    status is ``misaligned`` and ``can_alert`` is false.  Missing dates do not
    publish a warning-ready premium.
    """

    premium = calculate_etf_premium(market_price, reference_value, digits=digits)
    quote_date = china_calendar_date(quote_as_of)
    reference_date = china_calendar_date(reference_as_of)
    if quote_date and reference_date:
        alignment = "aligned" if quote_date == reference_date else "misaligned"
    else:
        alignment = "unknown"

    if premium is None or alignment == "unknown":
        return {
            "premium": None,
            "premium_status": "unavailable",
            "premium_alignment": alignment,
            "premium_as_of": None,
            "premium_quote_as_of": None,
            "premium_nav_as_of": None,
            "premium_basis": basis,
            "can_alert": False,
        }

    status = "fresh" if alignment == "aligned" else "misaligned"
    return {
        "premium": premium,
        "premium_status": status,
        "premium_alignment": alignment,
        "premium_as_of": quote_as_of,
        "premium_quote_as_of": quote_as_of,
        "premium_nav_as_of": reference_as_of,
        "premium_basis": basis,
        "can_alert": status == "fresh",
    }


def build_etf_premium_metrics(
    *,
    market_price: Any,
    quote_as_of: Any,
    nav: Any,
    nav_as_of: Any,
    iopv: Any = None,
    iopv_as_of: Any = None,
) -> Dict[str, Any]:
    """Build official-NAV and optional IOPV premium slots for one ETF row."""

    official = classify_etf_premium(
        market_price,
        nav,
        quote_as_of,
        nav_as_of,
        basis=OFFICIAL_NAV_PREMIUM_BASIS,
    )
    iopv_value = parse_number(iopv)
    iopv_result = classify_etf_premium(
        market_price,
        iopv_value,
        quote_as_of,
        iopv_as_of,
        basis=IOPV_PREMIUM_BASIS,
    )
    return {
        **official,
        "iopv": iopv_value if iopv_value is not None and iopv_value > 0 else None,
        "iopv_as_of": iopv_as_of if iopv_result["premium"] is not None else None,
        "iopv_premium": iopv_result["premium"],
        "iopv_premium_status": iopv_result["premium_status"],
        "iopv_premium_alignment": iopv_result["premium_alignment"],
        "iopv_basis": IOPV_PREMIUM_BASIS if iopv_result["premium"] is not None else None,
        "iopv_can_alert": iopv_result["can_alert"],
    }


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




SAME_DAY_PREMIUM_BASIS = "same_day_close_vs_same_day_nav"
_PREMIUM_HISTORY_MIN_POINTS = {30: 15, 90: 40}


def _premium_history_band(percentile: Optional[int]) -> str:
    if percentile is None:
        return ""
    if percentile >= 80:
        return "偏高"
    if percentile <= 20:
        return "偏低"
    return "中等"


def summarize_premium_history(
    points: Optional[Iterable[Mapping[str, Any]]],
    *,
    current_premium: Any = None,
    current_can_alert: bool = False,
    usable: bool = True,
    unusable_reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Describe where a current official NAV premium sits in 30/90-day history.

    Only same-day close vs same-day NAV points are used. A reference snapshot
    or a misaligned current premium must not produce a "high vs history" call.
    """

    rows: List[Tuple[str, float]] = []
    for item in points or []:
        if not isinstance(item, Mapping):
            continue
        basis = item.get("basis") or SAME_DAY_PREMIUM_BASIS
        if basis != SAME_DAY_PREMIUM_BASIS:
            continue
        premium = parse_number(item.get("premium"))
        date_s = item.get("full_date") or item.get("date")
        if premium is None or not date_s:
            continue
        rows.append((str(date_s), float(premium)))
    rows.sort(key=lambda row: row[0])

    reason = None if usable else (unusable_reason or "reference_snapshot")
    if not rows:
        usable = False
        reason = reason or "empty"

    def _empty_window(size: int, label: str) -> Dict[str, Any]:
        return {
            "window": size,
            "status": "unavailable",
            "count": 0,
            "min_points": _PREMIUM_HISTORY_MIN_POINTS[size],
            "min": None,
            "max": None,
            "median": None,
            "percentile": None,
            "band": None,
            "label": label,
        }

    def _window_stats(size: int) -> Dict[str, Any]:
        min_points = _PREMIUM_HISTORY_MIN_POINTS[size]
        if not usable:
            label = (
                "参考快照不用于判断当前溢价"
                if reason == "reference_snapshot"
                else "暂无同口径历史"
            )
            return _empty_window(size, label)
        values = [premium for _, premium in rows[-size:]]
        if len(values) < min_points:
            return {
                **_empty_window(size, "样本不足，暂不判断"),
                "count": len(values),
            }
        ordered = sorted(values)
        mid = len(ordered) // 2
        median = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
        current = parse_number(current_premium) if current_can_alert else None
        percentile = None
        band = None
        label = f"近{size}个交易日区间 {min(values):.2f}%～{max(values):.2f}%"
        if current is not None:
            rank = sum(1 for value in values if value <= current)
            percentile = int(round(rank / len(values) * 100))
            band = _premium_history_band(percentile)
            label = (
                f"近{size}个交易日{band}（{percentile}%分位，"
                f"区间 {min(values):.2f}%～{max(values):.2f}%）"
            )
        return {
            "window": size,
            "status": "ok",
            "count": len(values),
            "min_points": min_points,
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "median": round(median, 2),
            "percentile": percentile,
            "band": band,
            "label": label,
        }

    windows = {"30": _window_stats(30), "90": _window_stats(90)}
    return {
        "basis": SAME_DAY_PREMIUM_BASIS,
        "usable": bool(usable and rows),
        "reason": None if (usable and rows) else reason,
        "point_count": len(rows),
        "windows": windows,
    }


# Readable aliases for call sites that use domain-specific terminology.
etf_premium = calculate_etf_premium
rolling_one_year_return = extract_rolling_1y
merge_lkg = merge_last_known_good


_VALID_PURCHASE_STATUS = {"open", "limited", "suspended"}
_VALID_CHANNELS = {"agency"}
_VALID_SNAPSHOT_STATUS = {"fresh", "stale", "unavailable"}


def format_purchase_limit(status: Any, limit_cny: Any = None) -> str:
    """Format a canonical purchase status into the UI's short Chinese label."""

    if status == "suspended":
        return "暂停申购"
    parsed = parse_number(limit_cny)
    if status == "limited" and parsed is not None and parsed > 0:
        value = int(parsed) if float(parsed).is_integer() else round(parsed, 2)
        return f"{value}元"
    if status == "open":
        return "不限额"
    return "待确认"


def _valid_observation_date(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        observed = date.fromisoformat(value.strip())
    except ValueError:
        return None
    if observed.weekday() >= 5:
        return None
    return observed.isoformat()


def _history_point_key(point: Mapping[str, Any]) -> Tuple[str, str]:
    return (str(point.get("date") or ""), str(point.get("channel") or ""))


def normalize_subscription_history_point(raw: Any) -> Optional[Dict[str, Any]]:
    """Keep only a real observation day; never invent a date or a channel number."""

    if not isinstance(raw, Mapping):
        return None
    channel = raw.get("channel")
    status = raw.get("status")
    observed = _valid_observation_date(raw.get("date") or raw.get("full_date") or raw.get("observed_at"))
    if channel not in _VALID_CHANNELS or status not in _VALID_PURCHASE_STATUS or not observed:
        return None
    source = str(raw.get("source") or "").strip() or None
    if not source:
        return None
    limit_cny = parse_number(raw.get("daily_limit_cny"))
    if status != "limited" or limit_cny is None or limit_cny <= 0:
        limit_cny = None
    announced = raw.get("announced_at")
    announced_at = _valid_observation_date(announced) if isinstance(announced, str) else None
    display = raw.get("daily_limit") or format_purchase_limit(status, limit_cny)
    return {
        "date": observed,
        "full_date": observed,
        "channel": channel,
        "status": status,
        "daily_limit": display,
        "daily_limit_cny": limit_cny,
        "source": source,
        "announced_at": announced_at,
        "observed_at": observed,
    }


def read_subscription_history(points: Optional[Iterable[Any]]) -> List[Dict[str, Any]]:
    """Return stored observations only, sorted, with no backfilled dates."""

    cleaned: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str]] = set()
    for item in points or ():
        point = normalize_subscription_history_point(item)
        if not point:
            continue
        key = _history_point_key(point)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(point)
    cleaned.sort(key=lambda item: (item["date"], item["channel"]))
    return cleaned


def append_subscription_history(
    existing: Optional[Iterable[Any]],
    incoming: Optional[Iterable[Any]],
) -> List[Dict[str, Any]]:
    """Upsert valid observations by (date, channel). Same-day updates replace."""

    by_key: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for item in read_subscription_history(existing):
        by_key[_history_point_key(item)] = item
    for item in incoming or ():
        point = normalize_subscription_history_point(item)
        if not point:
            continue
        by_key[_history_point_key(point)] = point
    return [by_key[key] for key in sorted(by_key)]


def observation_from_agency_row(row: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    """Build an agency history point only from a fresh, valid business-day snapshot."""

    if not isinstance(row, Mapping):
        return None
    if row.get("subscription_status_status") != "fresh":
        return None
    return normalize_subscription_history_point({
        "date": row.get("subscription_as_of"),
        "channel": "agency",
        "status": row.get("subscription_status"),
        "daily_limit": row.get("daily_limit"),
        "daily_limit_cny": row.get("daily_limit_cny"),
        "source": row.get("subscription_source") or row.get("source") or AGENCY_SOURCE,
        "announced_at": None,
        "observed_at": row.get("subscription_as_of"),
    })


def _channel_status_label(status: str) -> str:
    return {
        "open": "开放申购",
        "limited": "限额申购",
        "suspended": "暂停申购",
    }.get(status, "待确认")


def _event_label(channel: str, kind: str, previous: Optional[Mapping[str, Any]], current: Mapping[str, Any]) -> str:
    channel_label = AGENCY_CHANNEL_LABEL
    current_text = _channel_status_label(current["status"])
    if current["status"] == "limited" and current.get("daily_limit"):
        current_text = f"{current_text} {current['daily_limit']}"
    if kind == "recorded":
        return f"{current['date']} {channel_label}开始记录：{current_text}"
    previous_text = _channel_status_label(previous["status"]) if previous else "待确认"
    if previous and previous.get("status") == "limited" and previous.get("daily_limit"):
        previous_text = f"{previous_text} {previous['daily_limit']}"
    return f"{current['date']} {channel_label}：{previous_text} → {current_text}"


def summarize_subscription_history(
    points: Optional[Iterable[Any]],
    channel: Optional[str] = None,
) -> Dict[str, Any]:
    """Describe pauses and limit changes. Missing days stay missing."""

    cleaned = read_subscription_history(points)
    if channel in _VALID_CHANNELS:
        cleaned = [item for item in cleaned if item["channel"] == channel]

    events: List[Dict[str, Any]] = []
    by_channel: Dict[str, List[Dict[str, Any]]] = {"agency": [], "direct": []}
    for item in cleaned:
        by_channel.setdefault(item["channel"], []).append(item)

    for channel_name, rows in by_channel.items():
        previous = None
        for item in rows:
            if previous is None:
                kind = "recorded"
            elif item["status"] == "suspended" and previous["status"] != "suspended":
                kind = "pause"
            elif previous["status"] == "suspended" and item["status"] != "suspended":
                kind = "resume"
            elif item.get("daily_limit_cny") != previous.get("daily_limit_cny") or item["status"] != previous["status"]:
                kind = "limit_change"
            else:
                previous = item
                continue
            events.append({
                "date": item["date"],
                "channel": channel_name,
                "kind": kind,
                "status": item["status"],
                "daily_limit": item.get("daily_limit"),
                "daily_limit_cny": item.get("daily_limit_cny"),
                "from_status": None if previous is None else previous["status"],
                "from_daily_limit": None if previous is None else previous.get("daily_limit"),
                "label": _event_label(channel_name, kind, previous, item),
            })
            previous = item

    events.sort(key=lambda item: (item["date"], item["channel"], item["kind"]))
    as_of = cleaned[-1]["date"] if cleaned else None
    return {
        "points": cleaned,
        "events": events,
        "count": len(cleaned),
        "as_of": as_of,
        "channels": {
            "agency": [item for item in cleaned if item["channel"] == "agency"],
        },
    }


def _snapshot_status_from_row(row: Mapping[str, Any], status: str) -> str:
    raw = row.get("subscription_status_status") or row.get("subscription_snapshot_status")
    if raw in _VALID_SNAPSHOT_STATUS:
        return raw
    return "unavailable" if status == "unknown" else "stale"


def build_agency_channel(row: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    data = row if isinstance(row, Mapping) else {}
    status = data.get("subscription_status")
    if status not in _VALID_PURCHASE_STATUS:
        status = "unknown"
    snapshot_status = _snapshot_status_from_row(data, status)
    limit_cny = parse_number(data.get("daily_limit_cny")) if status == "limited" else None
    if limit_cny is not None and limit_cny <= 0:
        limit_cny = None
    as_of = data.get("subscription_as_of") if isinstance(data.get("subscription_as_of"), str) else None
    if as_of and not _valid_observation_date(as_of) and status != "unknown":
        # Keep a displayed date even if it later gets sanitized elsewhere;
        # invalid weekend dates should already have been cleared by callers.
        pass
    display = data.get("daily_limit") or format_purchase_limit(status, limit_cny)
    if status == "unknown":
        display = display if display and display != "不限额" else "待确认"
        limit_cny = None
    return {
        "channel": "agency",
        "label": AGENCY_CHANNEL_LABEL,
        "status": status,
        "daily_limit": display,
        "daily_limit_cny": limit_cny,
        "as_of": as_of,
        "snapshot_status": snapshot_status,
        "source": AGENCY_SOURCE,
        "source_label": AGENCY_SOURCE_LABEL,
        "note": AGENCY_CALIBER_NOTE,
    }


def attach_subscription_channels(row: Any) -> Any:
    """Label current Eastmoney purchase fields as the agency/platform caliber."""

    if not isinstance(row, dict):
        return row
    agency = build_agency_channel(row)
    row["subscription_caliber"] = "eastmoney_agency"
    row["subscription_source"] = AGENCY_SOURCE
    row["subscription_source_label"] = AGENCY_SOURCE_LABEL
    row["subscription_channels"] = {"agency": agency}
    return row
