import math
import unittest
from datetime import date, datetime, timezone

from api.wise_etf.market import field_envelope, normalize_yahoo_monthly_returns


def _epoch(day_text):
    return int(datetime.fromisoformat(day_text).replace(tzinfo=timezone.utc).timestamp())


def _payload(symbol, observations, timezone_name="UTC"):
    return {
        "chart": {
            "result": [
                {
                    "meta": {
                        "symbol": symbol,
                        "currency": "USD",
                        "exchangeTimezoneName": timezone_name,
                    },
                    "timestamp": [_epoch(day) for day, _ in observations],
                    "indicators": {
                        "quote": [{"close": [close for _, close in observations]}]
                    },
                }
            ],
            "error": None,
        }
    }


def _month_observations(start_year, start_month, count, start_close=100.0):
    observations = []
    year, month = start_year, start_month
    for offset in range(count):
        observations.append((f"{year:04d}-{month:02d}-28T16:00:00", start_close + offset * 10.0))
        month += 1
        if month == 13:
            year += 1
            month = 1
    return observations


class FieldEnvelopeTests(unittest.TestCase):
    def test_infers_ok_and_serializes_date(self):
        self.assertEqual(
            field_envelope(14.89, as_of=date(2026, 8, 19), source="CBOE"),
            {
                "value": 14.89,
                "as_of": "2026-08-19",
                "source": "CBOE",
                "status": "ok",
            },
        )

    def test_none_is_unavailable(self):
        envelope = field_envelope(None, as_of=None, source="Multpl")
        self.assertEqual(envelope["status"], "unavailable")
        self.assertIsNone(envelope["value"])

    def test_explicit_stale_status_preserves_timestamp(self):
        as_of = datetime(2026, 8, 19, 16, 15, tzinfo=timezone.utc)
        envelope = field_envelope(29.71, as_of=as_of, source="Multpl", status="stale")
        self.assertEqual(envelope["status"], "stale")
        self.assertEqual(envelope["as_of"], "2026-08-19T16:15:00+00:00")

    def test_healthy_status_rejects_null_value(self):
        with self.assertRaises(ValueError):
            field_envelope(None, as_of=None, source="CBOE", status="ok")

    def test_healthy_value_requires_as_of(self):
        with self.assertRaises(ValueError):
            field_envelope(14.89, as_of=None, source="CBOE")


class YahooMonthlyReturnTests(unittest.TestCase):
    def test_supports_spx_and_returns_twelve_complete_months_plus_mtd(self):
        observations = _month_observations(2025, 7, 14)
        # The generated current-month observation falls on August 28; move it
        # before the August 20 reference date so it is a genuine MTD point.
        observations[-1] = ("2026-08-19T16:00:00", observations[-1][1])
        result = normalize_yahoo_monthly_returns(
            _payload("^GSPC", observations),
            "SPX",
            reference_date=date(2026, 8, 20),
        )

        self.assertEqual(result["index"], "SPX")
        self.assertEqual(result["symbol"], "^GSPC")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["months"]), 12)
        self.assertEqual(result["months"][0]["month"], "2025-08")
        self.assertEqual(result["months"][-1]["month"], "2026-07")
        self.assertEqual(result["mtd"]["month"], "2026-08")
        self.assertEqual(result["mtd"]["status"], "partial")
        self.assertTrue(result["mtd"]["is_partial"])
        self.assertEqual(result["as_of"], "2026-08-19")

    def test_supports_ndx_alias_and_exchange_timezone(self):
        observations = _month_observations(2025, 7, 14, start_close=200.0)
        result = normalize_yahoo_monthly_returns(
            _payload("^NDX", observations, "America/New_York"),
            "^NDX",
            reference_date=date(2026, 8, 31),
        )

        self.assertEqual(result["index"], "NDX")
        self.assertEqual(result["name"], "Nasdaq-100")
        self.assertEqual(result["timezone"], "America/New_York")
        self.assertEqual(result["return_type"], "price")

    def test_month_start_has_no_mtd_but_complete_months_remain_ok(self):
        observations = _month_observations(2025, 6, 14)
        result = normalize_yahoo_monthly_returns(
            _payload("^GSPC", observations),
            "SPX",
            reference_date=date(2026, 8, 1),
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["months"][-1]["month"], "2026-07")
        self.assertEqual(result["mtd"]["status"], "unavailable")
        self.assertIsNone(result["mtd"]["value"])
        self.assertEqual(result["mtd"]["base_date"], "2026-07-28")
        self.assertIsNone(result["mtd"]["end_date"])

    def test_missing_month_is_explicit_and_never_bridged(self):
        observations = _month_observations(2025, 7, 14)
        observations = [item for item in observations if not item[0].startswith("2026-06")]
        result = normalize_yahoo_monthly_returns(
            _payload("^NDX", observations),
            "NDX",
            reference_date=date(2026, 8, 20),
        )
        by_month = {row["month"]: row for row in result["months"]}

        self.assertEqual(result["status"], "partial")
        self.assertEqual(by_month["2026-06"]["status"], "unavailable")
        self.assertEqual(by_month["2026-07"]["status"], "unavailable")
        self.assertIsNone(by_month["2026-07"]["value"])
        self.assertEqual(by_month["2026-07"]["end_date"], "2026-07-28")

    def test_null_close_is_ignored_and_prior_valid_trading_day_is_used(self):
        observations = _month_observations(2025, 7, 13)
        observations.extend(
            [
                ("2026-07-29T16:00:00", 230.0),
                ("2026-07-30T16:00:00", None),
                ("2026-08-03T16:00:00", 241.5),
            ]
        )
        result = normalize_yahoo_monthly_returns(
            _payload("^GSPC", observations),
            "SPX",
            reference_date=date(2026, 8, 3),
        )
        july = result["months"][-1]

        self.assertEqual(july["month"], "2026-07")
        self.assertEqual(july["end_date"], "2026-07-29")
        self.assertEqual(july["status"], "ok")
        self.assertTrue(math.isclose(result["mtd"]["value"], 5.0, abs_tol=1e-9))

    def test_cross_year_month_order_and_immediate_base_month(self):
        observations = _month_observations(2024, 12, 15, start_close=1000.0)
        result = normalize_yahoo_monthly_returns(
            _payload("^NDX", observations),
            "NASDAQ-100",
            reference_date=date(2026, 2, 15),
        )

        labels = [row["month"] for row in result["months"]]
        self.assertEqual(labels[0], "2025-02")
        self.assertEqual(labels[-1], "2026-01")
        january = result["months"][-1]
        self.assertEqual(january["base_date"], "2025-12-28")
        self.assertEqual(january["end_date"], "2026-01-28")

    def test_yahoo_error_returns_error_envelope_without_throwing(self):
        payload = {"chart": {"result": None, "error": {"code": "Not Found", "description": "missing"}}}
        result = normalize_yahoo_monthly_returns(
            payload,
            "SPX",
            reference_date=date(2026, 8, 20),
        )

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"], "missing")
        self.assertTrue(all(row["status"] == "unavailable" for row in result["months"]))


if __name__ == "__main__":
    unittest.main()
