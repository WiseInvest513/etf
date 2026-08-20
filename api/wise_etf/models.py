"""Small immutable data contracts used by Wise ETF normalizers."""

from dataclasses import dataclass
from typing import Literal, Optional


PurchaseStatus = Literal["open", "limited", "suspended", "unknown"]


@dataclass(frozen=True, order=True)
class NavPoint:
    """A cumulative NAV observation normalized to Unix milliseconds."""

    timestamp_ms: int
    cumulative_nav: float


@dataclass(frozen=True)
class PurchaseSnapshot:
    """Normalized purchase availability for one fund.

    ``daily_limit_cny`` is actionable only for ``limited``.  A stale limit
    attached to a suspended fund is intentionally not exposed as actionable.
    """

    status: PurchaseStatus
    daily_limit_cny: Optional[float] = None
    raw_status: Optional[str] = None
