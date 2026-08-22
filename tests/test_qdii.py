import unittest

from datetime import datetime, timezone

from api.wise_etf.qdii import (
    canonicalize_symbol,
    combine_percent_returns,
    compute_fund_valuation,
    normalize_yahoo_quote,
    position_return_cny,
    quote_observation_is_recent,
)


class QDIISymbolTests(unittest.TestCase):
    def test_known_cross_market_symbols_are_canonical(self):
        self.assertEqual(canonicalize_symbol("00522", "116"), "0522.HK")
        self.assertEqual(canonicalize_symbol("285A"), "285A.T")
        self.assertEqual(canonicalize_symbol("6857"), "6857.T")
        self.assertEqual(canonicalize_symbol("6981"), "6981.T")
        self.assertEqual(canonicalize_symbol("2330"), "2330.TW")
        self.assertEqual(canonicalize_symbol("005930"), "005930.KS")


class QDIIQuoteTests(unittest.TestCase):
    def test_post_market_return_compounds_regular_and_post(self):
        quote = normalize_yahoo_quote({
            "symbol": "NVDA",
            "currency": "USD",
            "exchange": "NMS",
            "exchangeTimezoneName": "America/New_York",
            "marketState": "POST",
            "regularMarketPrice": 110,
            "regularMarketPreviousClose": 100,
            "regularMarketChangePercent": 10,
            "regularMarketTime": 1_787_342_400,
            "postMarketChangePercent": 10,
            "postMarketTime": 1_787_356_799,
        }, fetched_at="2026-08-22T00:00:00+00:00")
        self.assertIsNotNone(quote)
        self.assertAlmostEqual(quote["live_return_pct"], 21.0)
        self.assertEqual(quote["live_session"], "post")
        self.assertEqual(quote["regular_market_date"], "2026-08-21")

    def test_invalid_or_undated_quote_is_rejected(self):
        self.assertIsNone(normalize_yahoo_quote({
            "symbol": "NVDA",
            "regularMarketPrice": 100,
            "regularMarketChangePercent": 1,
        }))

    def test_weekend_close_is_recent_but_week_old_close_is_not(self):
        now = datetime(2026, 8, 22, 4, tzinfo=timezone.utc)
        base = {
            "exchange_timezone": "America/New_York",
            "regular_market_date": "2026-08-21",
        }
        self.assertTrue(quote_observation_is_recent(base, now=now))
        self.assertFalse(quote_observation_is_recent(
            {**base, "regular_market_date": "2026-08-14"}, now=now,
        ))


class QDIIValuationTests(unittest.TestCase):
    def test_currency_return_is_compounded(self):
        self.assertAlmostEqual(combine_percent_returns(10, 10), 21)
        self.assertAlmostEqual(position_return_cny(10, -10), -1)

    def test_missing_weight_is_not_scaled_to_one_hundred(self):
        holdings = [
            {"symbol": "NVDA", "name": "NVIDIA", "weight": 20},
            {"symbol": "0700.HK", "name": "Tencent", "weight": 10},
            {"symbol": "MISSING", "name": "Missing", "weight": 5},
        ]
        quotes = {
            "NVDA": {"currency": "USD", "regular_return_pct": 10, "data_status": "fresh"},
            "0700.HK": {"currency": "HKD", "regular_return_pct": 5, "data_status": "fresh"},
        }
        fx = {
            "USDCNY=X": {"regular_return_pct": 1, "data_status": "fresh"},
            "HKDCNY=X": {"regular_return_pct": 2, "data_status": "fresh"},
        }
        result = compute_fund_valuation(holdings, quotes, fx)
        # NVDA CNY return = 11.1%, Tencent = 7.1%; weighted contribution 2.93%.
        self.assertAlmostEqual(result["estimated_return_pct"], 2.93)
        self.assertEqual(result["coverage"]["disclosed_weight"], 35)
        self.assertEqual(result["coverage"]["priced_weight"], 30)
        self.assertEqual(result["quality_grade"], "partial")

    def test_missing_fx_does_not_silently_become_zero(self):
        result = compute_fund_valuation(
            [{"symbol": "NVDA", "weight": 10}],
            {"NVDA": {"currency": "USD", "regular_return_pct": 3, "data_status": "fresh"}},
            {},
        )
        self.assertIsNone(result["estimated_return_pct"])
        self.assertEqual(result["coverage"]["priced_weight"], 0)
        self.assertEqual(result["quality_grade"], "unavailable")


if __name__ == "__main__":
    unittest.main()
