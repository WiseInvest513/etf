import unittest

from datetime import datetime, timezone

from api.wise_etf.qdii import (
    canonicalize_symbol,
    classify_qdii_market_session,
    combine_percent_returns,
    compute_fund_valuation,
    normalize_yahoo_quote,
    position_return_cny,
    quote_observation_is_recent,
)


class QDIIMarketSessionTests(unittest.TestCase):
    def test_china_noon_is_close_display_not_us_premarket(self):
        self.assertEqual(
            classify_qdii_market_session(datetime(2026, 8, 25, 4, 15, tzinfo=timezone.utc)),
            "a_share",
        )

    def test_official_premarket_uses_dst_aware_new_york_clock(self):
        self.assertEqual(
            classify_qdii_market_session(datetime(2026, 8, 25, 8, 15, tzinfo=timezone.utc)),
            "pre_market",
        )
        self.assertEqual(
            classify_qdii_market_session(datetime(2026, 12, 15, 9, 15, tzinfo=timezone.utc)),
            "pre_market",
        )

    def test_weekday_overnight_gap_is_closed(self):
        self.assertEqual(
            classify_qdii_market_session(datetime(2026, 12, 15, 8, 30, tzinfo=timezone.utc)),
            "closed",
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
            "postMarketPrice": 121,
            "postMarketChangePercent": 10,
            "postMarketTime": 1_787_356_799,
        }, fetched_at="2026-08-22T00:00:00+00:00")
        self.assertIsNotNone(quote)
        self.assertAlmostEqual(quote["live_return_pct"], 21.0)
        self.assertEqual(quote["regular_price"], 110)
        self.assertEqual(quote["live_price"], 121)
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

    def test_live_valuation_keeps_the_matching_market_price(self):
        result = compute_fund_valuation(
            [{"symbol": "NVDA", "weight": 10}],
            {
                "NVDA": {
                    "currency": "USD",
                    "regular_price": 110,
                    "live_price": 112.5,
                    "regular_return_pct": 10,
                    "live_return_pct": 12.5,
                    "regular_as_of": "2026-08-24T20:00:00+00:00",
                    "live_as_of": "2026-08-24T21:00:00+00:00",
                    "data_status": "fresh",
                }
            },
            {"USDCNY=X": {"live_return_pct": 0, "data_status": "fresh"}},
            return_field="live_return_pct",
        )
        holding = result["holdings"][0]
        self.assertEqual(holding["asset_price"], 112.5)
        self.assertEqual(holding["price_as_of"], "2026-08-24T21:00:00+00:00")

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
