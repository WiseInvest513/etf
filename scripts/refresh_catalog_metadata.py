#!/usr/bin/env python3
"""Refresh low-frequency product metadata from Eastmoney.

This job intentionally does not fetch daily purchase or market fields.  It
updates only scale/report date, the finalized 2025 calendar return, and the
published annual tracking error.  Missing upstream values never overwrite the
last known catalog value.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.wise_etf import calendar_year_return  # noqa: E402
from scripts.build_product_catalog import (  # noqa: E402
    CatalogError,
    load_catalog,
    validate_catalog,
    write_catalog_atomic,
)


DEFAULT_CATALOG = ROOT / "catalog" / "products.v1.json"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
PING_RE = re.compile(r"Data_assetAllocation\s*=\s*(\{.*?\});", re.S)
AC_RE = re.compile(r"Data_ACWorthTrend\s*=\s*(\[.*?\]);", re.S)
TRACK_DISCLOSURE_RE = re.compile(r"截止至[：:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2})")
TRACKING_CATEGORIES = frozenset({"nasdaq_passive", "sp500_passive"})
CATALOG_SOURCE = "Eastmoney pingzhongdata/tsdata pages"
LEGACY_CATALOG_SOURCE = "Eastmoney pingzhongdata/product pages"

FIELD_BOUNDS = {
    "scale": (0.0, 100_000.0, False),
    "annual_return_2025": (-100.0, 1_000.0, False),
    "track_error": (0.0, 100.0, True),
}


def _fetch_text(url: str, *, attempts: int = 3) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/javascript,*/*",
                    "Referer": "https://fund.eastmoney.com/",
                },
            )
            with urllib.request.urlopen(request, timeout=18) as response:
                return response.read().decode("utf-8", "ignore")
        except Exception as exc:  # network boundary; reported per product
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(str(last_error or "request failed"))


def _source_date(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError:
        return None


def _disclosure_date(value: str) -> Optional[str]:
    """Normalize the date printed by the F10 page without inventing one."""

    parts = value.replace("/", "-").split("-")
    if len(parts) != 3:
        return None
    try:
        return date(*(int(part) for part in parts)).isoformat()
    except (TypeError, ValueError):
        return None


class _TrackingTableParser(HTMLParser):
    """Collect table cells without depending on Eastmoney's presentation tags."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self.text_parts: list[str] = []
        self._row: Optional[list[str]] = None
        self._cell_parts: Optional[list[str]] = None

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._row = []
        elif tag in {"th", "td"} and self._row is not None:
            self._cell_parts = []

    def handle_data(self, data: str) -> None:
        self.text_parts.append(data)
        if self._cell_parts is not None:
            self._cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"th", "td"} and self._row is not None and self._cell_parts is not None:
            text = re.sub(r"\s+", "", "".join(self._cell_parts))
            self._row.append(text)
            self._cell_parts = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
            self._cell_parts = None


def _asset_metadata(script: str) -> tuple[Optional[float], Optional[str]]:
    match = PING_RE.search(script)
    if not match:
        return None, None
    payload = json.loads(match.group(1))
    categories = payload.get("categories") or []
    for series in payload.get("series") or []:
        if series.get("name") != "净资产":
            continue
        values = series.get("data") or []
        for index in range(len(values) - 1, -1, -1):
            value = values[index]
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(float(value))
                and value > 0
            ):
                as_of = _source_date(categories[index]) if index < len(categories) else None
                if as_of is not None:
                    return round(float(value), 2), as_of
    return None, None


def _annual_return(script: str) -> Optional[float]:
    match = AC_RE.search(script)
    if not match:
        return None
    return calendar_year_return(json.loads(match.group(1)), 2025)


def _tracking_metadata(html: str) -> tuple[Optional[float], Optional[str]]:
    """Read the index row and disclosure date from an Eastmoney F10 page."""

    parser = _TrackingTableParser()
    parser.feed(html)
    parser.close()

    tracking_error = None
    for row_index, row in enumerate(parser.rows):
        try:
            column_index = row.index("年化跟踪误差")
        except ValueError:
            continue

        # The live F10 page uses a header row followed by a value row.  Keep a
        # same-row fallback for older variants of the page.
        candidates = []
        if row_index + 1 < len(parser.rows):
            next_row = parser.rows[row_index + 1]
            if column_index < len(next_row):
                candidates.append(next_row[column_index])
        for index, cell in enumerate(row[:-1]):
            if cell == "指数":
                candidates.append(row[index + 1])

        for candidate in candidates:
            match = re.search(r"([-+]?\d+(?:\.\d+)?)%", candidate)
            if match:
                value = float(match.group(1))
                if math.isfinite(value):
                    tracking_error = round(value, 2)
                    break
        if tracking_error is not None:
            break

    # Several unrelated sections have their own 截止至 date.  Start at the
    # tracking-error header so the date belongs to this table, not fund scale.
    header_text_index = next(
        (
            index
            for index, part in enumerate(parser.text_parts)
            if re.sub(r"\s+", "", part) == "年化跟踪误差"
        ),
        None,
    )
    tracking_text = (
        " ".join(parser.text_parts[header_text_index:])
        if header_text_index is not None
        else ""
    )
    disclosure_match = TRACK_DISCLOSURE_RE.search(tracking_text)
    disclosure_as_of = (
        _disclosure_date(disclosure_match.group(1)) if disclosure_match else None
    )
    return tracking_error, disclosure_as_of


def _tracking_error(html: str) -> Optional[float]:
    """Compatibility wrapper for callers interested only in the value."""

    return _tracking_metadata(html)[0]


def _needs_tracking(product: dict[str, Any]) -> bool:
    return product.get("product_type") == "etf" or bool(
        set(product.get("categories") or []) & TRACKING_CATEGORIES
    )


def _refresh_one(product: dict[str, Any]) -> dict[str, Any]:
    code = product["code"]
    field_errors: dict[str, str] = {}
    scale = None
    scale_as_of = None
    annual = None
    ping_fetched = False
    try:
        script = _fetch_text(f"https://fund.eastmoney.com/pingzhongdata/{code}.js")
        ping_fetched = True
        try:
            scale, scale_as_of = _asset_metadata(script)
            if scale is None:
                field_errors["scale"] = (
                    "positive scale with a valid report date was not found"
                )
        except Exception as exc:
            field_errors["scale"] = f"scale parser failed: {exc}"
        try:
            annual = _annual_return(script)
            if annual is None:
                field_errors["annual_return_2025"] = (
                    "2025 calendar return was not found"
                )
        except Exception as exc:
            field_errors["annual_return_2025"] = f"return parser failed: {exc}"
    except Exception as exc:
        message = str(exc)
        field_errors["scale"] = message
        field_errors["annual_return_2025"] = message

    needs_tracking = _needs_tracking(product)
    tracking_error = None
    tracking_as_of = None
    if needs_tracking:
        try:
            html = _fetch_text(f"https://fundf10.eastmoney.com/tsdata_{code}.html")
            tracking_error, tracking_as_of = _tracking_metadata(html)
            missing = []
            if tracking_error is None:
                missing.append("published annual tracking error")
            if tracking_as_of is None:
                missing.append("upstream disclosure date")
            if missing:
                tracking_error = None
                tracking_as_of = None
                field_errors["track_error"] = " and ".join(missing) + " was not found"
        except Exception as exc:
            # Scale and finalized annual return share the pingzhongdata request
            # and remain usable when only the F10 page is unavailable.
            field_errors["track_error"] = str(exc)

    return {
        "code": code,
        "ping_fetched": ping_fetched,
        "scale": scale,
        "scale_as_of": scale_as_of,
        "annual_return_2025": annual,
        "track_error": tracking_error,
        "track_error_as_of": tracking_as_of,
        "track_error_expected": needs_tracking,
        "field_errors": field_errors,
    }


def _finite_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _change_multiple(old: float, new: float) -> float:
    if old <= 0 or new <= 0:
        return math.inf if old != new else 1.0
    return max(old / new, new / old)


def _anomaly_reason(
    field: str,
    value: Any,
    snapshot: dict[str, Any],
    *,
    max_scale_change: float,
    max_tracking_change: float,
    finalized_return_tolerance: float,
) -> Optional[str]:
    number = _finite_number(value)
    if number is None:
        return "value is not a finite number"

    minimum, maximum, minimum_inclusive = FIELD_BOUNDS[field]
    below_minimum = number < minimum or (number == minimum and not minimum_inclusive)
    if below_minimum or number > maximum:
        left = "[" if minimum_inclusive else "("
        return f"value {number:g} is outside {left}{minimum:g}, {maximum:g}]"

    old = _finite_number(snapshot.get(field))
    if field == "annual_return_2025":
        if (
            old is not None
            and snapshot.get("annual_return_2025_as_of") == "2025-12-31"
            and abs(number - old) > finalized_return_tolerance
        ):
            return (
                f"finalized 2025 return changed from {old:g} to {number:g} "
                f"(tolerance {finalized_return_tolerance:g}pp)"
            )
        return None

    if old is None:
        return None
    if field == "scale" and snapshot.get("scale_as_of"):
        multiple = _change_multiple(old, number)
        if multiple > max_scale_change:
            return f"scale changed {multiple:.2f}x (limit {max_scale_change:g}x)"
    if field == "track_error" and snapshot.get("track_error_as_of"):
        multiple = _change_multiple(old, number)
        if multiple > max_tracking_change:
            return f"tracking error changed {multiple:.2f}x (limit {max_tracking_change:g}x)"
    return None


def _as_of_anomaly_reason(
    field: str,
    value: Any,
    snapshot: dict[str, Any],
    *,
    checked_on: str,
) -> Optional[str]:
    """Reject fabricated, future, or regressing source dates.

    The previous catalog used the fetch date for tracking-error observations.
    ``track_error_as_of == metadata_fetched_at`` identifies those rows and lets
    the first F10 refresh replace that synthetic date with the real disclosure
    date, even when the disclosure precedes the fetch by a few days.
    """

    normalized = _source_date(value)
    if normalized is None:
        return "upstream disclosure date is missing or invalid"
    if normalized > checked_on:
        return f"upstream date {normalized} is after refresh date {checked_on}"

    date_key = f"{field}_as_of"
    previous = _source_date(snapshot.get(date_key))
    migrating_synthetic_tracking_date = (
        field == "track_error"
        and previous is not None
        and previous == _source_date(snapshot.get("metadata_fetched_at"))
    )
    if previous and normalized < previous and not migrating_synthetic_tracking_date:
        return f"upstream date regressed from {previous} to {normalized}"
    return None


def refresh_catalog(
    catalog: dict[str, Any],
    *,
    workers: int = 6,
    checked_on: Optional[date] = None,
    max_scale_change: float = 10.0,
    max_tracking_change: float = 10.0,
    finalized_return_tolerance: float = 0.10,
) -> tuple[dict[str, Any], dict[str, Any]]:
    validate_catalog(catalog)
    products = catalog.get("products") or []
    successes: dict[str, dict[str, Any]] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(_refresh_one, product): product["code"] for product in products}
        for future in as_completed(futures):
            code = futures[future]
            try:
                successes[code] = future.result()
            except Exception as exc:
                errors[code] = str(exc)

    today = (checked_on or date.today()).isoformat()
    field_expected = {
        "scale": len(products),
        "annual_return_2025": len(products),
        "track_error": sum(1 for product in products if _needs_tracking(product)),
    }
    field_updates = {field: 0 for field in field_expected}
    field_errors: dict[str, dict[str, str]] = {}
    anomalies: dict[str, str] = {}
    accepted_total = 0

    for product in products:
        update = successes.get(product["code"])
        if not update:
            continue
        code = product["code"]
        if update.get("field_errors"):
            field_errors[code] = dict(update["field_errors"])
        snapshot = product.setdefault("static_snapshot", {})
        accepted_any = False

        scale = update.get("scale")
        if scale is not None:
            reason = _as_of_anomaly_reason(
                "scale", update.get("scale_as_of"), snapshot, checked_on=today
            ) or _anomaly_reason(
                "scale",
                scale,
                snapshot,
                max_scale_change=max_scale_change,
                max_tracking_change=max_tracking_change,
                finalized_return_tolerance=finalized_return_tolerance,
            )
            if reason:
                anomalies[f"{code}.scale"] = reason
            else:
                snapshot["scale"] = scale
                snapshot["scale_as_of"] = update.get("scale_as_of")
                product["metadata_as_of"] = update.get("scale_as_of") or product.get("metadata_as_of")
                field_updates["scale"] += 1
                accepted_any = True

        annual = update.get("annual_return_2025")
        if annual is not None:
            reason = _anomaly_reason(
                "annual_return_2025",
                annual,
                snapshot,
                max_scale_change=max_scale_change,
                max_tracking_change=max_tracking_change,
                finalized_return_tolerance=finalized_return_tolerance,
            )
            if reason:
                anomalies[f"{code}.annual_return_2025"] = reason
            else:
                snapshot["annual_return_2025"] = annual
                snapshot["annual_return_2025_as_of"] = "2025-12-31"
                field_updates["annual_return_2025"] += 1
                accepted_any = True

        tracking = update.get("track_error")
        if tracking is not None and update.get("track_error_expected"):
            reason = _as_of_anomaly_reason(
                "track_error",
                update.get("track_error_as_of"),
                snapshot,
                checked_on=today,
            ) or _anomaly_reason(
                "track_error",
                tracking,
                snapshot,
                max_scale_change=max_scale_change,
                max_tracking_change=max_tracking_change,
                finalized_return_tolerance=finalized_return_tolerance,
            )
            if reason:
                anomalies[f"{code}.track_error"] = reason
            else:
                snapshot["track_error"] = tracking
                snapshot["track_error_as_of"] = update["track_error_as_of"]
                field_updates["track_error"] += 1
                accepted_any = True

        if accepted_any:
            snapshot["metadata_fetched_at"] = today
            accepted_total += 1

    if accepted_total:
        catalog["metadata_as_of"] = today
    if catalog.get("catalog_version") == "1.0.0":
        catalog["catalog_version"] = "1.1.0"
    source = catalog.setdefault("source", [])
    normalized_source = [
        CATALOG_SOURCE if item == LEGACY_CATALOG_SOURCE else item for item in source
    ]
    if CATALOG_SOURCE not in normalized_source:
        normalized_source.append(CATALOG_SOURCE)
    source[:] = list(dict.fromkeys(normalized_source))

    field_coverage = {
        field: (field_updates[field] / expected if expected else 1.0)
        for field, expected in field_expected.items()
    }
    fetched = sum(
        1 for update in successes.values() if update.get("ping_fetched", True)
    )
    summary = {
        "total": len(products),
        "fetched": fetched,
        "failed": len(products) - fetched,
        # Legacy scalar counts are retained for existing operator tooling.
        "scale_updates": field_updates["scale"],
        "annual_return_updates": field_updates["annual_return_2025"],
        "tracking_error_updates": field_updates["track_error"],
        "field_expected": field_expected,
        "field_updates": field_updates,
        "field_coverage": field_coverage,
        "field_errors": field_errors,
        "anomalies": anomalies,
        "errors": errors,
    }
    validate_catalog(catalog)
    return catalog, summary


def refresh_quality_issues(
    summary: dict[str, Any],
    *,
    min_fetch_coverage: float = 0.90,
    min_scale_coverage: float = 0.90,
    min_annual_coverage: float = 0.90,
    min_tracking_coverage: float = 0.85,
) -> list[str]:
    issues: list[str] = []
    total = int(summary.get("total") or 0)
    fetched = int(summary.get("fetched") or 0)
    fetch_coverage = fetched / total if total else 0.0
    if fetch_coverage < min_fetch_coverage:
        issues.append(f"fetch coverage {fetch_coverage:.1%} is below {min_fetch_coverage:.1%}")

    coverage = summary.get("field_coverage") or {}
    requirements = {
        "scale": min_scale_coverage,
        "annual_return_2025": min_annual_coverage,
        "track_error": min_tracking_coverage,
    }
    for field, minimum in requirements.items():
        actual = float(coverage.get(field, 0.0))
        if actual < minimum:
            issues.append(f"{field} coverage {actual:.1%} is below {minimum:.1%}")

    anomalies = summary.get("anomalies") or {}
    if anomalies:
        issues.append(f"{len(anomalies)} anomalous field value(s) require manual review")
    return issues


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--min-coverage", type=float, default=0.90, help="minimum ping request coverage")
    parser.add_argument("--min-scale-coverage", type=float, default=0.90)
    parser.add_argument("--min-annual-coverage", type=float, default=0.90)
    parser.add_argument("--min-tracking-coverage", type=float, default=0.85)
    parser.add_argument("--max-scale-change", type=float, default=10.0, help="maximum reviewed scale multiple")
    parser.add_argument("--max-tracking-change", type=float, default=10.0, help="maximum reviewed tracking-error multiple")
    parser.add_argument("--finalized-return-tolerance", type=float, default=0.10, help="maximum 2025 return revision in percentage points")
    args = parser.parse_args(argv)

    coverage_values = (
        args.min_coverage,
        args.min_scale_coverage,
        args.min_annual_coverage,
        args.min_tracking_coverage,
    )
    if any(value < 0 or value > 1 for value in coverage_values):
        parser.error("coverage thresholds must be between 0 and 1")
    if args.max_scale_change < 1 or args.max_tracking_change < 1:
        parser.error("change multiples must be at least 1")
    if args.finalized_return_tolerance < 0:
        parser.error("finalized return tolerance must be non-negative")

    try:
        catalog = load_catalog(args.catalog)
        refreshed, summary = refresh_catalog(
            catalog,
            workers=args.workers,
            max_scale_change=args.max_scale_change,
            max_tracking_change=args.max_tracking_change,
            finalized_return_tolerance=args.finalized_return_tolerance,
        )
        issues = refresh_quality_issues(
            summary,
            min_fetch_coverage=args.min_coverage,
            min_scale_coverage=args.min_scale_coverage,
            min_annual_coverage=args.min_annual_coverage,
            min_tracking_coverage=args.min_tracking_coverage,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if issues:
            print("catalog not written:", file=sys.stderr)
            for issue in issues:
                print(f"- {issue}", file=sys.stderr)
            return 1
        if args.write:
            write_catalog_atomic(args.catalog, refreshed)
        return 0
    except (CatalogError, OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
