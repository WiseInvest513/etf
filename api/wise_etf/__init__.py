"""Pure data contracts and normalizers for Wise ETF.

This package deliberately has no HTTP, database, cache, or framework imports so
the same rules can be reused by API jobs, web responses, and future clients.
"""

from .models import NavPoint, PurchaseSnapshot, PurchaseStatus
from .market import field_envelope, normalize_yahoo_monthly_returns
from .normalizers import (
    append_subscription_history,
    attach_subscription_channels,
    calendar_year_return,
    calculate_etf_premium,
    china_calendar_date,
    classify_etf_premium,
    build_etf_premium_metrics,
    extract_rolling_1y,
    format_purchase_limit,
    merge_last_known_good,
    normalize_purchase,
    normalize_purchase_status,
    observation_from_agency_row,
    parse_number,
    read_subscription_history,
    rolling_nav_return,
    safe_sort,
    summarize_premium_history,
    summarize_subscription_history,
)
from .qdii import (
    canonicalize_symbol,
    classify_qdii_market_session,
    combine_percent_returns,
    compute_fund_valuation,
    currency_for_symbol,
    fx_pair_for_currency,
    normalize_yahoo_quote,
    position_return_cny,
    quote_observation_is_recent,
)

__all__ = [
    "NavPoint",
    "PurchaseSnapshot",
    "PurchaseStatus",
    "calendar_year_return",
    "calculate_etf_premium",
    "china_calendar_date",
    "classify_etf_premium",
    "build_etf_premium_metrics",
    "extract_rolling_1y",
    "field_envelope",
    "merge_last_known_good",
    "normalize_purchase",
    "normalize_purchase_status",
    "normalize_yahoo_monthly_returns",
    "parse_number",
    "rolling_nav_return",
    "safe_sort",
    "summarize_premium_history",
    "append_subscription_history",
    "attach_subscription_channels",
    "format_purchase_limit",
    "observation_from_agency_row",
    "read_subscription_history",
    "summarize_subscription_history",
    "canonicalize_symbol",
    "classify_qdii_market_session",
    "combine_percent_returns",
    "compute_fund_valuation",
    "currency_for_symbol",
    "fx_pair_for_currency",
    "normalize_yahoo_quote",
    "position_return_cny",
    "quote_observation_is_recent",
]
