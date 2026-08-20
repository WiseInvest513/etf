import math
import unittest
from datetime import date

from api.wise_etf.normalizers import (
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


class ParseNumberTests(unittest.TestCase):
    def test_parses_common_feed_formats(self):
        self.assertEqual(parse_number(" 1,234.50 "), 1234.5)
        self.assertEqual(parse_number("12.5%"), 12.5)
        self.assertEqual(parse_number("￥2万"), 20000.0)
        self.assertEqual(parse_number("(12.5)"), -12.5)

    def test_rejects_missing_and_non_finite_values(self):
        for value in (None, "", "--", "None", "oops", True, math.nan, math.inf):
            with self.subTest(value=value):
                self.assertIsNone(parse_number(value))


class PurchaseTests(unittest.TestCase):
    def test_suspension_takes_priority_over_stale_limit(self):
        self.assertEqual(normalize_purchase_status("暂停申购", "500"), "suspended")
        snapshot = normalize_purchase("暂停申购", 500)
        self.assertEqual(snapshot.status, "suspended")
        self.assertIsNone(snapshot.daily_limit_cny)

    def test_large_purchase_pause_still_allows_small_subscriptions(self):
        snapshot = normalize_purchase("暂停大额申购", 500)
        self.assertEqual(snapshot.status, "limited")
        self.assertEqual(snapshot.daily_limit_cny, 500)

    def test_limited_open_and_unknown(self):
        limited = normalize_purchase("开放申购", "10,000")
        self.assertEqual(limited.status, "limited")
        self.assertEqual(limited.daily_limit_cny, 10000.0)
        self.assertEqual(normalize_purchase_status("开放申购", "0"), "open")
        self.assertEqual(normalize_purchase_status("场内交易"), "open")
        self.assertEqual(normalize_purchase_status(None), "unknown")


class ReturnTests(unittest.TestCase):
    def test_calendar_return_uses_previous_year_last_nav(self):
        points = [
            [date(2025, 12, 31), 1.20],
            [date(2024, 12, 30), 1.00],
            [date(2025, 1, 2), 1.10],
            [date(2024, 6, 28), 0.90],
        ]
        self.assertEqual(calendar_year_return(points, 2025), 20.0)

    def test_calendar_return_requires_both_calendar_years(self):
        self.assertIsNone(calendar_year_return([[date(2025, 1, 2), 1.1]], 2025))
        self.assertIsNone(calendar_year_return([[date(2024, 12, 30), 1.0]], 2025))

    def test_rolling_one_year_primary_and_fallback(self):
        periods = [{"title": "1N", "syl": "8.25"}]
        self.assertEqual(extract_rolling_1y({"SYL_1N": "9.50"}, periods), 9.5)
        self.assertEqual(extract_rolling_1y({"SYL_1N": "--"}, periods), 8.25)
        self.assertIsNone(extract_rolling_1y({}, [{"title": "3Y", "syl": "1"}]))

    def test_rolling_nav_return_uses_cumulative_nav_near_one_year_baseline(self):
        points = [
            [date(2025, 8, 18), 2.0],
            [date(2026, 8, 18), 2.4],
        ]
        self.assertEqual(rolling_nav_return(points), 20.0)

    def test_rolling_nav_return_rejects_short_or_distant_history(self):
        self.assertIsNone(rolling_nav_return([[date(2026, 1, 1), 1.0], [date(2026, 8, 18), 1.2]]))
        self.assertIsNone(rolling_nav_return([[date(2025, 7, 1), 1.0], [date(2026, 8, 18), 1.2]]))


class EtfTests(unittest.TestCase):
    def test_premium_requires_both_positive_sides(self):
        self.assertEqual(calculate_etf_premium("1.05", "1.00"), 5.0)
        self.assertEqual(calculate_etf_premium("0.95", "1.00"), -5.0)
        for price, nav in ((None, 1), (1, None), (1, 0), (0, 1), ("--", 1)):
            with self.subTest(price=price, nav=nav):
                self.assertIsNone(calculate_etf_premium(price, nav))

    def test_safe_sort_is_null_last_in_both_directions(self):
        records = [
            {"code": "missing", "premium": None},
            {"code": "high", "premium": "5.0"},
            {"code": "low", "premium": -1.0},
            {"code": "placeholder", "premium": "--"},
            {"code": "absent"},
        ]
        self.assertEqual(
            [row["code"] for row in safe_sort(records, "premium")],
            ["low", "high", "missing", "placeholder", "absent"],
        )
        self.assertEqual(
            [row["code"] for row in safe_sort(records, "premium", reverse=True)],
            ["high", "low", "missing", "placeholder", "absent"],
        )


class LastKnownGoodTests(unittest.TestCase):
    def test_failed_fields_do_not_overwrite_good_values(self):
        previous = {
            "market_price": 1.05,
            "premium": 5.0,
            "returns": {"rolling_1y": 10.0, "day_change": 1.0},
            "volume": 12.0,
        }
        incoming = {
            "market_price": None,
            "premium": 0.0,
            "returns": {"rolling_1y": None, "day_change": -0.5},
            "volume": 0.0,
        }
        merged = merge_last_known_good(previous, incoming)
        self.assertEqual(merged["market_price"], 1.05)
        self.assertEqual(merged["premium"], 0.0)
        self.assertEqual(merged["returns"], {"rolling_1y": 10.0, "day_change": -0.5})
        self.assertEqual(merged["volume"], 0.0)

    def test_explicit_failed_dotted_path_is_preserved(self):
        previous = {"returns": {"rolling_1y": 10.0, "day_change": 1.0}}
        incoming = {"returns": {"rolling_1y": 99.0, "day_change": -0.5}}
        merged = merge_last_known_good(previous, incoming, {"returns.rolling_1y"})
        self.assertEqual(merged["returns"], {"rolling_1y": 10.0, "day_change": -0.5})


if __name__ == "__main__":
    unittest.main()
