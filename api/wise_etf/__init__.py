"""Pure data contracts and normalizers for Wise ETF.

This package deliberately has no HTTP, database, cache, or framework imports so
the same rules can be reused by API jobs, web responses, and future clients.
"""

from .models import NavPoint, PurchaseSnapshot, PurchaseStatus
from .market import field_envelope, normalize_yahoo_monthly_returns
from .normalizers import (
    calendar_year_return,
    calculate_etf_premium,
    extract_rolling_1y,
    merge_last_known_good,
    normalize_purchase,
    normalize_purchase_status,
    parse_number,
    rolling_nav_return,
    safe_sort,
)
from .qdii import (
    canonicalize_symbol,
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
    "extract_rolling_1y",
    "field_envelope",
    "merge_last_known_good",
    "normalize_purchase",
    "normalize_purchase_status",
    "normalize_yahoo_monthly_returns",
    "parse_number",
    "rolling_nav_return",
    "safe_sort",
    "canonicalize_symbol",
    "combine_percent_returns",
    "compute_fund_valuation",
    "currency_for_symbol",
    "fx_pair_for_currency",
    "normalize_yahoo_quote",
    "position_return_cny",
    "quote_observation_is_recent",
]
