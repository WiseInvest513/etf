"""Route-level regression tests for cache promotion and stale-data contracts.

All external providers and Redis writes are mocked.  These tests intentionally
exercise the route functions directly so a failed upstream request can never
silently become a new last-known-good snapshot.
"""

from __future__ import annotations

import os
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from fastapi import HTTPException, Response

import api.index as api


class CacheNamespaceTests(unittest.TestCase):
    def test_market_cache_is_versioned_but_user_data_is_not(self):
        self.assertEqual(api._storage_key("funds_sp500_passive"), "wise:data:v2:funds_sp500_passive")
        self.assertEqual(api._storage_key("lkg:etfs"), "wise:data:v2:lkg:etfs")
        self.assertEqual(api._storage_key("market_sentiment_v2"), "wise:data:v2:market_sentiment_v2")
        self.assertEqual(api._storage_key("wise_user:person@example.com"), "wise_user:person@example.com")
        self.assertEqual(api._storage_key("wx_fav:openid"), "wx_fav:openid")

    def test_market_v2_can_be_cleared_by_exact_admin_key(self):
        with (
            patch.object(api, "_require_job_secret"),
            patch.object(api, "_get_redis", return_value=object()),
            patch.object(api, "_cache_delete") as delete,
        ):
            payload = api.cache_delete_key("market_sentiment_v2", None)

        delete.assert_called_once_with("market_sentiment_v2")
        self.assertTrue(payload["ok"])


class DailyBoardContractTests(unittest.TestCase):
    def test_board_is_read_only_and_marks_old_dynamic_values_stale(self):
        old_fund = {
            "code": "F1",
            "subscription_status": "limited",
            "daily_limit": "50元",
            "subscription_as_of": "2026-08-24",
            "subscription_status_status": "fresh",
        }
        old_etf = {
            "code": "E1",
            "premium": 4.2,
            "premium_status": "fresh",
            "premium_quote_as_of": "2026-08-22T15:05:00+08:00",
        }

        def cache_mget(keys):
            return {
                key: [old_etf] if key == "etfs" else [old_fund]
                for key in keys if not key.startswith("lkg:")
            }

        now = datetime(2026, 8, 25, 12, tzinfo=api._CHINA_TZ)
        with (
            patch.object(api, "_cache_mget", side_effect=cache_mget),
            patch.object(api, "_china_now", return_value=now),
            patch.object(api, "_expected_cn_close_date", return_value="2026-08-24"),
            patch.object(api, "_build_funds", side_effect=AssertionError("provider build forbidden")),
            patch.object(api, "_build_etfs", side_effect=AssertionError("provider build forbidden")),
        ):
            payload = api.get_daily_board(Response())

        self.assertEqual(payload["funds"]["status"], "stale")
        self.assertEqual(payload["funds"]["data"][0]["subscription_snapshot_status"], "stale")
        self.assertEqual(payload["funds"]["data"][0]["daily_limit"], "50元")
        self.assertEqual(payload["etfs"]["status"], "stale")
        self.assertEqual(payload["etfs"]["data"][0]["premium_snapshot_status"], "stale")
        self.assertEqual(payload["etfs"]["data"][0]["premium"], 4.2)

    def test_board_accepts_only_expected_day_snapshots_as_fresh(self):
        fund = {
            "code": "F1",
            "subscription_status": "open",
            "subscription_as_of": "2026-08-25",
            "subscription_status_status": "fresh",
        }
        etf = {
            "code": "E1",
            "premium": 1.2,
            "premium_status": "fresh",
            "premium_quote_as_of": "2026-08-24T15:05:00+08:00",
        }

        def cache_mget(keys):
            return {
                key: [etf] if key == "etfs" else [fund]
                for key in keys if not key.startswith("lkg:")
            }

        now = datetime(2026, 8, 25, 12, tzinfo=api._CHINA_TZ)
        with (
            patch.object(api, "_cache_mget", side_effect=cache_mget),
            patch.object(api, "_china_now", return_value=now),
            patch.object(api, "_expected_cn_close_date", return_value="2026-08-24"),
        ):
            payload = api.get_daily_board(Response())

        self.assertEqual(payload["funds"]["status"], "fresh")
        self.assertEqual(payload["etfs"]["status"], "fresh")


class TrackingErrorProviderTests(unittest.TestCase):
    def test_tracking_error_uses_disclosed_date_from_tsdata_page(self):
        html = """
        <th>跟踪指数</th><th>年化跟踪误差</th><th>同类平均跟踪误差</th>
        <tr><td>纳斯达克100指数</td><td>1.17%</td><td>2.29%</td></tr>
        <div>截止至：2026-08-18</div>
        """
        response = SimpleNamespace(ok=True, text=html)
        with patch.object(api, "_get", return_value=response) as get:
            result = api._fetch_tracking_error("160213")

        self.assertEqual(result["track_error"], 1.17)
        self.assertEqual(result["track_error_as_of"], "2026-08-18")
        self.assertEqual(result["track_error_source"], "eastmoney_tsdata")
        self.assertIn("tsdata_160213.html", get.call_args.args[0])


class IndexReturnContractTests(unittest.TestCase):
    def test_period_return_uses_exact_number_of_intervals_and_market_timestamp(self):
        start = int(datetime(2026, 7, 29, tzinfo=timezone.utc).timestamp())
        timestamps = [start + index * 86400 for index in range(22)]
        market_time = int(datetime(2026, 8, 20, 20, tzinfo=timezone.utc).timestamp())
        chart = {
            "meta": {
                "regularMarketPrice": 122,
                "regularMarketPreviousClose": 121,
                "regularMarketTime": market_time,
            },
            "timestamp": timestamps,
            "indicators": {"quote": [{"close": list(range(100, 122))}]},
        }
        with patch.object(api, "_yf_chart", return_value=chart):
            result = api.fetch_index_price("^NDX")

        self.assertEqual(result["returns"]["mo1"], 22.0)
        self.assertEqual(result["returns"]["d15"], round((122 / 106 - 1) * 100, 2))
        self.assertEqual(result["as_of"], "2026-08-20")


class YahooCredentialTests(unittest.TestCase):
    def test_chart_invalidates_and_retries_on_auth_or_rate_limit(self):
        chart = {"meta": {"regularMarketPrice": 1}}
        for status_code in (401, 429):
            with self.subTest(status_code=status_code):
                first = SimpleNamespace(ok=False, status_code=status_code)
                second = SimpleNamespace(
                    ok=True,
                    status_code=200,
                    json=lambda: {"chart": {"result": [chart]}},
                )
                with (
                    patch.object(api, "_yf_get_crumb", side_effect=[("old", {}), ("new", {})]),
                    patch.object(api, "_get", side_effect=[first, second]) as get,
                    patch.object(api, "_yf_invalidate_crumb") as invalidate,
                ):
                    result = api._yf_chart("^NDX")

                self.assertEqual(result, chart)
                invalidate.assert_called_once_with("old")
                self.assertEqual(get.call_count, 2)

    def test_cold_crumb_handshake_is_singleflight_across_threads(self):
        class FakeSession:
            def __init__(self):
                self.cookies = {"A3": "cookie"}

            def get(self, url, **_kwargs):
                if url == "https://fc.yahoo.com":
                    time.sleep(0.05)
                    return SimpleNamespace(ok=False, text="")
                return SimpleNamespace(ok=True, text="shared-crumb")

        factory = Mock(side_effect=FakeSession)
        original = dict(api._YF_CRUMB)
        api._YF_CRUMB.update({"crumb": None, "cookies": None, "ts": 0.0})
        barrier = threading.Barrier(4)

        def fetch():
            barrier.wait()
            return api._yf_get_crumb()

        try:
            with (
                patch.object(api, "_cache_get", return_value=None),
                patch.object(api, "_cache_set"),
                patch.object(api.requests, "Session", factory),
                ThreadPoolExecutor(max_workers=4) as executor,
            ):
                results = [future.result() for future in [executor.submit(fetch) for _ in range(4)]]
        finally:
            api._YF_CRUMB.update(original)

        self.assertEqual(factory.call_count, 1)
        self.assertEqual(results, [("shared-crumb", {"A3": "cookie"})] * 4)


class NasdaqPeContractTests(unittest.TestCase):
    def test_official_invesco_characteristics_is_primary_and_dated(self):
        response = SimpleNamespace(
            ok=True,
            status_code=200,
            json=lambda: {
                "effectiveDate": "2026-07-31",
                "priceToEarningsRatio": 29.997909,
            },
        )
        with patch.object(api, "_get", return_value=response) as get:
            result = api.fetch_nasdaq100_pe()

        self.assertEqual(result["pe"], 30.0)
        self.assertEqual(result["as_of"], "2026-07-31")
        self.assertEqual(result["source"], "Invesco QQQ fund characteristics")
        self.assertEqual(result["pe_type"], "weighted_harmonic_trailing")
        self.assertEqual(result["data_status"], "fresh")
        self.assertIsNone(result["percentile"])
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.kwargs["params"]["variationType"], "fundCharacteristics")
        self.assertEqual(get.call_args.kwargs["headers"]["Referer"], "https://www.invesco.com/")

    def test_invesco_failure_retries_then_uses_dated_official_reference(self):
        rejected = SimpleNamespace(ok=False, status_code=406)
        with (
            patch.object(api, "_get", return_value=rejected) as get,
            patch.object(api.time, "sleep") as sleep,
        ):
            result = api.fetch_nasdaq100_pe()

        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(0.15)
        self.assertEqual(result["pe"], 34.45)
        self.assertEqual(result["as_of"], "2026-06-30")
        self.assertEqual(result["source"], "Invesco QQQ Q2 2026 factsheet")
        self.assertEqual(result["data_status"], "reference")
        self.assertIsNone(result["percentile"])


class DailyNavFallbackTests(unittest.TestCase):
    def test_pingzhongdata_fallback_only_supplies_nav_derived_fields(self):
        china_tz = timezone(timedelta(hours=8))
        baseline = int(datetime(2025, 8, 18, tzinfo=china_tz).timestamp() * 1000)
        endpoint = int(datetime(2026, 8, 18, tzinfo=china_tz).timestamp() * 1000)
        script = f"""
        var Data_netWorthTrend = [
          {{"x": {endpoint}, "y": 2.4, "equityReturn": -1.25}}
        ];
        var Data_ACWorthTrend = [[{baseline}, 2.0], [{endpoint}, 2.4]];
        """

        result = api._parse_pingzhong_daily("513100", script)

        self.assertEqual(result["nav"], 2.4)
        self.assertEqual(result["nav_date"], "2026-08-18")
        self.assertEqual(result["day_change"], -1.25)
        self.assertEqual(result["rolling_1y"], 20.0)
        self.assertEqual(result["daily_source_status"], "partial")
        self.assertNotIn("subscription_status", result)

    def test_partial_basic_and_fallback_keep_value_date_groups_atomic(self):
        basic = {
            "DWJZ": None,
            "FSRQ": "2026-08-20",
            "RZDF": None,
            "SYL_1N": None,
            "SGZT": "限大额",
            "MAXSG": "50",
        }
        fallback = {
            "code": "160213",
            "nav": 2.4,
            "nav_date": "2026-08-18",
            "day_change": -1.2,
            "day_change_as_of": "2026-08-18",
            "rolling_1y": 20.0,
            "rolling_1y_as_of": "2026-08-18",
            "daily_source_status": "partial",
        }
        with (
            patch.object(api, "_fetch_basic_information", return_value=basic),
            patch.object(api, "_fetch_pingzhong_daily", return_value=fallback),
        ):
            result = api._fetch_daily_snapshot("160213")

        self.assertEqual(result["nav"], 2.4)
        self.assertEqual(result["nav_date"], "2026-08-18")
        self.assertEqual(result["day_change_as_of"], "2026-08-18")
        self.assertEqual(result["rolling_1y_as_of"], "2026-08-18")
        self.assertEqual(result["subscription_status"], "limited")
        self.assertEqual(result["daily_source_status"], "full")

    def test_missing_day_change_only_uses_fallback_for_missing_group(self):
        basic = {
            "DWJZ": "2.5",
            "FSRQ": "2026-08-20",
            "RZDF": None,
            "SYL_1N": "21",
            "SGZT": "开放申购",
            "MAXSG": "0",
        }
        fallback = {
            "code": "160213",
            "nav": 2.4,
            "nav_date": "2026-08-18",
            "day_change": -1.2,
            "day_change_as_of": "2026-08-18",
            "rolling_1y": 20.0,
            "rolling_1y_as_of": "2026-08-18",
            "daily_source_status": "partial",
        }
        with (
            patch.object(api, "_fetch_basic_information", return_value=basic),
            patch.object(api, "_fetch_pingzhong_daily", return_value=fallback) as ping,
        ):
            result = api._fetch_daily_snapshot("160213")

        ping.assert_called_once_with("160213")
        self.assertEqual(result["nav"], 2.5)
        self.assertEqual(result["nav_date"], "2026-08-20")
        self.assertEqual(result["rolling_1y"], 21.0)
        self.assertEqual(result["rolling_1y_as_of"], "2026-08-20")
        self.assertEqual(result["day_change"], -1.2)
        self.assertEqual(result["day_change_as_of"], "2026-08-18")

    def test_rolling_as_of_uses_actual_cumulative_nav_endpoint(self):
        china_tz = timezone(timedelta(hours=8))
        baseline = int(datetime(2025, 8, 17, tzinfo=china_tz).timestamp() * 1000)
        ac_endpoint = int(datetime(2026, 8, 17, tzinfo=china_tz).timestamp() * 1000)
        nav_endpoint = int(datetime(2026, 8, 18, tzinfo=china_tz).timestamp() * 1000)
        script = f"""
        var Data_netWorthTrend = [
          {{"x": {nav_endpoint}, "y": 2.4, "equityReturn": -1.25}}
        ];
        var Data_ACWorthTrend = [[{baseline}, 2.0], [{ac_endpoint}, 2.4]];
        """

        result = api._parse_pingzhong_daily("513100", script)

        self.assertEqual(result["nav_date"], "2026-08-18")
        self.assertEqual(result["rolling_1y_as_of"], "2026-08-17")
        self.assertNotIn("daily_limit", result)

    def test_basic_failure_does_not_invent_purchase_state(self):
        fallback = {
            "code": "513100",
            "nav": 2.4,
            "nav_date": "2026-08-18",
            "rolling_1y": 20.0,
            "daily_source_status": "partial",
        }
        with (
            patch.object(api, "_fetch_basic_information", return_value=None),
            patch.object(api, "_fetch_pingzhong_daily", return_value=fallback),
        ):
            result = api._fetch_daily_snapshot("513100")

        self.assertEqual(result, fallback)
        self.assertNotIn("subscription_status", result)


class JobSecretTests(unittest.TestCase):
    def test_missing_secret_fails_closed_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HTTPException) as raised:
                api._require_job_secret(None)

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "CRON_SECRET is not configured")

    def test_explicit_development_environment_can_opt_in(self):
        for environment in ("development", "dev", "local", "test"):
            with self.subTest(environment=environment):
                with patch.dict(os.environ, {"APP_ENV": environment}, clear=True):
                    api._require_job_secret(None)

    def test_explicit_insecure_local_flag_can_opt_in(self):
        with patch.dict(os.environ, {"ALLOW_INSECURE_LOCAL_JOBS": "true"}, clear=True):
            api._require_job_secret(None)

    def test_configured_secret_requires_matching_bearer_token(self):
        with patch.dict(os.environ, {"CRON_SECRET": "expected-secret"}, clear=True):
            for supplied in (None, "", "wrong", "Bearer wrong"):
                with self.subTest(supplied=supplied):
                    with self.assertRaises(HTTPException) as raised:
                        api._require_job_secret(supplied)
                    self.assertEqual(raised.exception.status_code, 401)

            api._require_job_secret("Bearer expected-secret")


class AuthSigningSecretTests(unittest.TestCase):
    def setUp(self):
        self.original_env_secret = api._JWT_SECRET
        self.original_cache = api._JWT_SECRET_CACHE
        api._JWT_SECRET = ""
        api._JWT_SECRET_CACHE = None

    def tearDown(self):
        api._JWT_SECRET = self.original_env_secret
        api._JWT_SECRET_CACHE = self.original_cache

    def test_redis_persisted_secret_is_used_when_env_is_missing(self):
        redis = Mock()
        redis.get.return_value = "s" * 48
        with patch.object(api, "_get_redis", return_value=redis):
            first = api._require_jwt_secret()
            second = api._require_jwt_secret()

        self.assertEqual(first, "s" * 48)
        self.assertEqual(second, first)
        redis.get.assert_called_once_with(api._JWT_SECRET_REDIS_KEY)
        redis.set.assert_not_called()

    def test_missing_secret_is_generated_once_with_set_nx(self):
        redis = Mock()
        redis.get.return_value = None
        redis.set.return_value = True
        with patch.object(api, "_get_redis", return_value=redis):
            secret = api._require_jwt_secret()

        self.assertGreaterEqual(len(secret), 32)
        redis.set.assert_called_once_with(api._JWT_SECRET_REDIS_KEY, secret, nx=True)

    def test_concurrent_winner_is_read_when_set_nx_loses(self):
        redis = Mock()
        winner = "w" * 48
        redis.get.side_effect = [None, winner]
        redis.set.return_value = False
        with patch.object(api, "_get_redis", return_value=redis):
            secret = api._require_jwt_secret()

        self.assertEqual(secret, winner)


class FundCacheContractTests(unittest.TestCase):
    @staticmethod
    def _full_fund_snapshot(code="160213"):
        return {
            "code": code,
            "nav": 2.4,
            "nav_date": "2026-08-18",
            "day_change": -1.2,
            "day_change_as_of": "2026-08-18",
            "rolling_1y": 20.0,
            "rolling_1y_as_of": "2026-08-18",
            "subscription_status": "limited",
            "subscription_status_status": "fresh",
            "buy_status": "open",
            "daily_limit": "50元",
            "daily_limit_cny": 50,
            "daily_source_status": "full",
        }

    def test_tracking_failure_does_not_block_daily_snapshot(self):
        catalog_row = {
            "code": "160213",
            "name": "Fund",
            "track_error": 1.17,
            "track_error_as_of": "2026-08-18",
        }
        with (
            patch.object(api, "STATIC_FUNDS", {"nasdaq_passive": [catalog_row]}),
            patch.object(api, "_lkg_get", return_value=None),
            patch.object(api, "_china_now", return_value=datetime(2026, 8, 20, 10, tzinfo=timezone(timedelta(hours=8)))),
            patch.object(api, "fetch_one_fund", return_value={
                **self._full_fund_snapshot(),
                "subscription_as_of": "2026-08-20",
            }),
            patch.object(api, "_fetch_tracking_error", return_value=None),
        ):
            rows, source = api._build_funds("nasdaq_passive")

        self.assertEqual(source, "live")
        self.assertEqual(rows[0]["data_status"], "fresh")
        self.assertEqual(rows[0]["track_error_status"], "stale")

    def test_nav_only_fallback_never_reuses_old_purchase_limit(self):
        catalog_row = {"code": "100055", "name": "Fund"}
        previous = [{
            **catalog_row,
            "subscription_status": "limited",
            "buy_status": "open",
            "daily_limit": "1000元",
            "daily_limit_cny": 1000,
            "subscription_as_of": "2026-08-19",
        }]
        fallback = {
            "code": "100055",
            "nav": 2.4,
            "nav_date": "2026-08-18",
            "day_change": -1.2,
            "day_change_as_of": "2026-08-18",
            "rolling_1y": 20.0,
            "rolling_1y_as_of": "2026-08-18",
            "daily_source_status": "partial",
        }
        with (
            patch.object(api, "STATIC_FUNDS", {"us_active": [catalog_row]}),
            patch.object(api, "_lkg_get", return_value=previous),
            patch.object(api, "fetch_one_fund", return_value=fallback),
        ):
            rows, source = api._build_funds("us_active")

        self.assertEqual(source, "partial")
        self.assertEqual(rows[0]["subscription_status"], "unknown")
        self.assertEqual(rows[0]["subscription_status_status"], "unavailable")
        self.assertEqual(rows[0]["daily_limit"], "待确认")
        self.assertIsNone(rows[0]["daily_limit_cny"])

    def test_older_daily_groups_cannot_replace_newer_lkg(self):
        catalog_row = {"code": "100055", "name": "Fund"}
        previous = [{
            **catalog_row,
            "nav": 2.5,
            "nav_date": "2026-08-20",
            "day_change": 1.0,
            "day_change_as_of": "2026-08-20",
            "rolling_1y": 25.0,
            "rolling_1y_as_of": "2026-08-20",
            "subscription_status": "limited",
            "subscription_status_status": "fresh",
            "subscription_as_of": "2026-08-20",
            "daily_limit": "1000元",
            "daily_limit_cny": 1000,
        }]
        older = {
            **self._full_fund_snapshot("100055"),
            "subscription_as_of": "2026-08-20",
        }
        with (
            patch.object(api, "STATIC_FUNDS", {"us_active": [catalog_row]}),
            patch.object(api, "_lkg_get", return_value=previous),
            patch.object(api, "_china_now", return_value=datetime(2026, 8, 20, 10, tzinfo=timezone(timedelta(hours=8)))),
            patch.object(api, "fetch_one_fund", return_value=older),
        ):
            rows, source = api._build_funds("us_active")

        self.assertEqual(source, "partial")
        self.assertEqual(rows[0]["nav"], 2.5)
        self.assertEqual(rows[0]["nav_date"], "2026-08-20")
        self.assertEqual(rows[0]["rolling_1y"], 25.0)

    def test_partial_fund_refresh_only_updates_hot_cache(self):
        rows = [{"code": "050025", "rolling_1y": 12.3, "data_status": "partial"}]
        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_recovery_gate_active", return_value=False),
            patch.object(api, "_build_funds", return_value=(rows, "partial")),
            patch.object(api, "_publish_cache") as publish,
            patch.object(api, "_cache_set") as cache_set,
        ):
            payload = api.get_funds("sp500_passive", Response())

        publish.assert_not_called()
        self.assertIn(call("funds_sp500_passive", rows, api.RECOVERY_CACHE_TTL), cache_set.call_args_list)
        self.assertIn(
            call("recovery_gate:funds_sp500_passive", {"active": True}, api.RECOVERY_CACHE_TTL),
            cache_set.call_args_list,
        )
        self.assertEqual(payload["source"], "partial")
        self.assertEqual(payload["status"], "partial")

    def test_partial_cache_follower_does_not_start_duplicate_refresh(self):
        rows = [{"code": "050025", "rolling_1y": 12.3, "data_status": "partial"}]
        cache_key = "funds_sp500_passive"
        held = api._try_recovery_refresh(cache_key)
        self.assertIsNotNone(held)
        try:
            with (
                patch.object(api, "_mem_get", return_value=rows),
                patch.object(api, "_recovery_gate_active", return_value=False),
                patch.object(api, "STATIC_FUNDS", {"sp500_passive": [{"code": "050025"}]}),
                patch.object(api, "_build_funds") as build,
            ):
                payload = api.get_funds("sp500_passive", Response())
        finally:
            held.release()

        build.assert_not_called()
        self.assertEqual(payload["source"], "cache")
        self.assertEqual(payload["status"], "partial")

    def test_recovery_gate_backs_off_repeated_partial_requests(self):
        rows = [{"code": "050025", "data_status": "partial"}]
        with (
            patch.object(api, "_mem_get", return_value=rows),
            patch.object(api, "_recovery_gate_active", return_value=True),
            patch.object(api, "_build_funds") as build,
        ):
            payload = api.get_funds("sp500_passive", Response())

        build.assert_not_called()
        self.assertEqual(payload["source"], "cache")
        self.assertEqual(payload["status"], "partial")

    def test_true_cold_concurrent_requests_run_builder_once(self):
        started = threading.Event()
        release = threading.Event()
        barrier = threading.Barrier(5)
        counter_lock = threading.Lock()
        calls = 0
        rows = [{"code": "050025", "data_status": "fresh"}]

        def build(_category):
            nonlocal calls
            with counter_lock:
                calls += 1
            started.set()
            release.wait(timeout=2)
            return rows, "live"

        def request():
            barrier.wait()
            return api.get_funds("sp500_passive", Response())

        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_file_load", return_value=None),
            patch.object(api, "STATIC_FUNDS", {"sp500_passive": [{"code": "050025"}]}),
            patch.object(api, "_build_funds", side_effect=build),
            patch.object(api, "_publish_cache"),
            ThreadPoolExecutor(max_workers=5) as executor,
        ):
            futures = [executor.submit(request) for _ in range(5)]
            self.assertTrue(started.wait(timeout=1))
            time.sleep(0.05)
            release.set()
            payloads = [future.result(timeout=2) for future in futures]

        self.assertEqual(calls, 1)
        self.assertEqual(sum(item["source"] == "live" for item in payloads), 1)
        self.assertEqual(sum(item["source"] == "refresh_in_progress" for item in payloads), 4)

    def test_recovery_lock_is_released_when_builder_raises(self):
        rows = [{"code": "019524", "data_status": "partial"}]
        cache_key = "funds_nasdaq_passive"
        with (
            patch.object(api, "_mem_get", return_value=rows),
            patch.object(api, "_recovery_gate_active", return_value=False),
            patch.object(api, "STATIC_FUNDS", {"nasdaq_passive": [{"code": "019524"}]}),
            patch.object(api, "_build_funds", side_effect=RuntimeError("boom")),
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                api.get_funds("nasdaq_passive", Response())

        probe = api._try_recovery_refresh(cache_key)
        self.assertIsNotNone(probe)
        probe.release()

    def test_fund_lkg_is_rehydrated_as_stale(self):
        previous = [{
            "code": "050025",
            "rolling_1y": 11.0,
            "nav_date": "2026-08-19",
            "data_status": "fresh",
            "daily_status": "fresh",
        }]
        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_build_funds", return_value=([], "none")),
            patch.object(api, "_file_load", return_value=previous),
            patch.object(api, "_cache_set") as cache_set,
            patch.object(api, "_publish_cache") as publish,
        ):
            payload = api.get_funds("sp500_passive", Response())

        publish.assert_not_called()
        self.assertEqual(payload["source"], "lkg")
        self.assertEqual(payload["status"], "stale")
        self.assertEqual(payload["data"][0]["data_status"], "stale")
        self.assertEqual(payload["data"][0]["daily_status"], "stale")
        cached_rows = cache_set.call_args_list[0].args[1]
        self.assertEqual(cached_rows[0]["data_status"], "stale")
        self.assertEqual(previous[0]["data_status"], "fresh")


class EtfCacheContractTests(unittest.TestCase):
    def setUp(self):
        self._now_patch = patch.object(
            api,
            "_china_now",
            return_value=datetime(2026, 8, 20, 15, 30, tzinfo=timezone(timedelta(hours=8))),
        )
        self._now_patch.start()

    def tearDown(self):
        self._now_patch.stop()

    @staticmethod
    def _daily_etf_snapshot(*, rolling_1y=20.0, day_change=-1.2):
        return {
            "code": "513100",
            "nav": 1.60,
            "nav_date": "2026-08-18",
            "rolling_1y": rolling_1y,
            "rolling_1y_as_of": "2026-08-18" if rolling_1y is not None else None,
            "day_change": day_change,
            "day_change_as_of": "2026-08-18" if day_change is not None else None,
            "source": "test",
        }

    def test_incomplete_etf_daily_fields_never_promote_lkg(self):
        catalog_row = {
            "code": "513100",
            "name": "ETF",
            "track_error": 1.0,
            "track_error_as_of": "2026-08-18",
        }
        quote = {"513100": {
            "market_price": 1.70,
            "market_change_pct": 1.2,
            "change_pct": 1.2,
            "quote_as_of": "2026-08-20T07:00:00+00:00",
            "quote_source": "test",
        }}
        with (
            patch.object(api, "STATIC_ETFS", [catalog_row]),
            patch.object(api, "_lkg_get", return_value=None),
            patch.object(api, "fetch_etfs_em_fallback", return_value=quote),
            patch.object(api, "_fetch_daily_snapshot", return_value=self._daily_etf_snapshot(rolling_1y=None)),
            patch.object(api, "_fetch_tracking_error", return_value={
                "track_error": 1.0,
                "track_error_as_of": "2026-08-20",
                "track_error_source": "test",
            }),
            patch.object(api, "fetch_etfs_sina_batch", return_value={}),
        ):
            rows, source = api._build_etfs()

        self.assertEqual(source, "partial")
        self.assertEqual(rows[0]["data_status"], "partial")
        self.assertEqual(rows[0]["premium_status"], "fresh")

    def test_quote_without_timestamp_cannot_create_fresh_premium(self):
        catalog_row = {
            "code": "513100",
            "name": "ETF",
            "track_error": 1.0,
            "track_error_as_of": "2026-08-18",
        }
        quote = {"513100": {
            "market_price": 1.70,
            "market_change_pct": 1.2,
            "change_pct": 1.2,
            "quote_as_of": None,
            "quote_source": "test",
        }}
        with (
            patch.object(api, "STATIC_ETFS", [catalog_row]),
            patch.object(api, "_lkg_get", return_value=None),
            patch.object(api, "fetch_etfs_em_fallback", return_value=quote),
            patch.object(api, "_fetch_daily_snapshot", return_value=self._daily_etf_snapshot()),
            patch.object(api, "_fetch_tracking_error", return_value={
                "track_error": 1.0,
                "track_error_as_of": "2026-08-20",
                "track_error_source": "test",
            }),
            patch.object(api, "fetch_etfs_sina_batch", return_value={}),
        ):
            rows, source = api._build_etfs()

        self.assertEqual(source, "partial")
        self.assertNotEqual(rows[0]["premium_status"], "fresh")
        self.assertIsNone(rows[0].get("premium"))

    def test_intraday_quote_cannot_create_or_publish_fresh_premium(self):
        catalog_row = {"code": "513100", "name": "ETF"}
        quote = {"513100": {
            "market_price": 1.70,
            "market_change_pct": 1.2,
            "quote_as_of": "2026-08-20T02:30:00+00:00",
            "quote_source": "test",
        }}
        with (
            patch.object(api, "_china_now", return_value=datetime(2026, 8, 20, 10, 30, tzinfo=timezone(timedelta(hours=8)))),
            patch.object(api, "STATIC_ETFS", [catalog_row]),
            patch.object(api, "_lkg_get", return_value=None),
            patch.object(api, "fetch_etfs_sina_batch", return_value=quote),
            patch.object(api, "_fetch_daily_snapshot", return_value=self._daily_etf_snapshot()),
            patch.object(api, "_fetch_tracking_error", return_value=None),
            patch.object(api, "fetch_etfs_em_fallback", return_value={}),
        ):
            rows, source = api._build_etfs()

        self.assertEqual(source, "partial")
        self.assertNotEqual(rows[0]["premium_status"], "fresh")
        self.assertIsNone(rows[0].get("premium"))

    def test_new_quote_and_failed_nav_do_not_recompute_old_premium(self):
        catalog_row = {
            "code": "513100",
            "name": "ETF",
            "track_error": 1.0,
            "track_error_as_of": "2026-08-18",
        }
        previous = [{
            **catalog_row,
            "market_price": 1.70,
            "quote_as_of": "2026-08-19T07:00:00+00:00",
            "nav": 1.60,
            "nav_as_of": "2026-08-18",
            "premium": 6.25,
            "premium_pct": 6.25,
            "premium_as_of": "2026-08-19T07:00:00+00:00",
        }]
        new_quote = {
            "513100": {
                "market_price": 1.80,
                "market_change_pct": 1.2,
                "change_pct": 1.2,
                "quote_as_of": "2026-08-20T07:00:00+00:00",
                "quote_source": "eastmoney_push2",
            },
        }
        with (
            patch.object(api, "STATIC_ETFS", [catalog_row]),
            patch.object(api, "_lkg_get", return_value=previous),
            patch.object(api, "fetch_etfs_em_fallback", return_value=new_quote),
            patch.object(api, "_fetch_daily_snapshot", return_value=None),
            patch.object(api, "_fetch_tracking_error", return_value={
                "track_error": 0.9,
                "track_error_as_of": "2026-08-20",
                "track_error_source": "test",
            }),
            patch.object(api, "fetch_etfs_sina_batch", return_value={}),
        ):
            rows, source = api._build_etfs()

        self.assertEqual(source, "partial")
        self.assertEqual(rows[0]["market_price"], 1.80)
        self.assertEqual(rows[0]["quote_as_of"], "2026-08-20T07:00:00+00:00")
        self.assertEqual(rows[0]["nav"], 1.60)
        self.assertEqual(rows[0]["premium"], 6.25)
        self.assertEqual(rows[0]["premium_as_of"], "2026-08-19T07:00:00+00:00")
        self.assertEqual(rows[0]["premium_status"], "stale")

    def test_public_etf_get_only_serves_existing_cache(self):
        rows = [{"code": "513100", "premium": 1.2, "data_status": "partial"}]
        with (
            patch.object(api, "_mem_get", return_value=rows),
            patch.object(api, "_recovery_gate_active", return_value=True),
            patch.object(api, "_build_etfs") as build,
            patch.object(api, "_publish_cache") as publish,
            patch.object(api, "_cache_set") as cache_set,
        ):
            payload = api.get_etfs(Response())

        build.assert_not_called()
        publish.assert_not_called()
        cache_set.assert_not_called()
        self.assertEqual(payload["source"], "cache")
        self.assertEqual(payload["status"], "stale")

    def test_true_cold_public_etf_get_returns_reference_without_building(self):
        with (
            patch.object(api, "_china_now", return_value=datetime(2026, 8, 20, 10, 30, tzinfo=timezone(timedelta(hours=8)))),
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_file_load", return_value=None),
            patch.object(api, "STATIC_ETFS", [{"code": "513100"}]),
            patch.object(api, "_build_etfs") as build,
        ):
            payload = api.get_etfs(Response())

        build.assert_not_called()
        self.assertEqual(payload["source"], "reference")

    def test_after_close_cold_get_runs_one_guarded_recovery(self):
        rows = [{
            "code": "513100",
            "market_price": 1.75,
            "premium": 2.94,
            "quote_as_of": "2026-08-20T15:00:00+08:00",
            "premium_quote_as_of": "2026-08-20T15:00:00+08:00",
            "premium_status": "fresh",
            "data_status": "fresh",
        }]
        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_file_load", return_value=None),
            patch.object(api, "STATIC_ETFS", [{"code": "513100"}]),
            patch.object(api, "_recovery_gate_active", return_value=False),
            patch.object(api, "_acquire_job_lock", return_value="run-token"),
            patch.object(api, "_release_job_lock") as release,
            patch.object(api, "_build_etfs", return_value=(rows, "live")) as build,
            patch.object(api, "_store_snapshot", return_value=True) as store,
        ):
            payload = api.get_etfs(Response())

        build.assert_called_once_with()
        store.assert_called_once_with("etfs", rows, "live", api.CACHE_TTL["etfs"])
        release.assert_called_once_with("etfs:close", "run-token")
        self.assertEqual(payload["source"], "live")
        self.assertEqual(payload["status"], "fresh")

    def test_etf_lkg_is_rehydrated_with_field_level_stale_statuses(self):
        previous = [{
            "code": "513100",
            "market_price": 1.75,
            "nav": 1.70,
            "premium": 2.94,
            "quote_as_of": "2026-08-19T07:00:00+00:00",
            "nav_as_of": "2026-08-18",
            "data_status": "fresh",
            "quote_status": "fresh",
            "nav_status": "fresh",
            "premium_status": "fresh",
        }]
        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_build_etfs", return_value=([], "none")),
            patch.object(api, "_file_load", return_value=previous),
            patch.object(api, "_recovery_gate_active", return_value=True),
            patch.object(api, "_cache_set") as cache_set,
            patch.object(api, "_publish_cache") as publish,
        ):
            payload = api.get_etfs(Response())

        publish.assert_not_called()
        self.assertEqual(payload["source"], "lkg")
        self.assertEqual(payload["status"], "stale")
        row = payload["data"][0]
        self.assertEqual(row["data_status"], "stale")
        self.assertEqual(row["quote_status"], "stale")
        self.assertEqual(row["nav_status"], "stale")
        self.assertEqual(row["premium_status"], "stale")
        self.assertEqual(row["fund_daily_status"], "stale")
        cache_set.assert_not_called()
        self.assertEqual(previous[0]["data_status"], "fresh")


class LiveDataCacheContractTests(unittest.TestCase):
    def test_partial_live_data_merges_lkg_without_promoting_it(self):
        previous = {
            "000001": {"rolling_1y": 10.0, "nav_date": "2026-08-18"},
            "000002": {"rolling_1y": 20.0, "nav_date": "2026-08-18"},
        }
        incoming = {
            "000001": {"rolling_1y": 11.0, "nav_date": "2026-08-19"},
        }
        with (
            patch.object(api, "_ALL_CODES", ["000001", "000002"]),
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_build_live_data", return_value=incoming),
            patch.object(api, "_lkg_get", side_effect=lambda key: previous if key == "live_data" else None),
            patch.object(api, "_publish_cache") as publish,
            patch.object(api, "_lkg_set") as lkg_set,
            patch.object(api, "_cache_set") as cache_set,
        ):
            payload = api.get_live_data(Response())

        publish.assert_not_called()
        lkg_set.assert_not_called()
        self.assertEqual(payload["source"], "partial")
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["fresh_count"], 1)
        self.assertEqual(payload["total_count"], 2)
        self.assertEqual(payload["data"]["000001"]["rolling_1y"], 11.0)
        self.assertEqual(payload["data"]["000002"]["rolling_1y"], 20.0)
        self.assertEqual(previous["000001"]["rolling_1y"], 10.0)
        self.assertIn(
            call("live_data", payload["data"], api.RECOVERY_CACHE_TTL),
            cache_set.call_args_list,
        )

    def test_true_cold_follower_does_not_duplicate_live_builder(self):
        held = api._try_recovery_refresh("live_data")
        self.assertIsNotNone(held)
        try:
            with (
                patch.object(api, "_mem_get", return_value=None),
                patch.object(api, "_lkg_get", return_value=None),
                patch.object(api, "_build_live_data") as build,
            ):
                payload = api.get_live_data(Response())
        finally:
            held.release()

        build.assert_not_called()
        self.assertEqual(payload["source"], "refresh_in_progress")


class MarketSentimentContractTests(unittest.TestCase):
    def test_dated_qqq_reference_is_displayable_but_never_promotes_lkg(self):
        dated = lambda value: {"value": value, "as_of": "2026-08-19"}
        qqq_reference = {
            "pe": 34.45,
            "as_of": "2026-06-30",
            "source": "Invesco QQQ Q2 2026 factsheet",
            "data_status": "reference",
            "percentile": None,
        }
        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "_lkg_get", return_value=None),
            patch.object(api, "fetch_vix", return_value=dated(18.0)),
            patch.object(api, "fetch_fear_greed", return_value=dated(55.0)),
            patch.object(api, "fetch_sp500_pe", return_value={"pe": 29.0, "as_of": "2026-08-19"}),
            patch.object(api, "fetch_nasdaq100_pe", return_value=qqq_reference),
            patch.object(api, "fetch_index_price", side_effect=lambda symbol: {
                "price": 25000 if symbol == "^NDX" else 6500,
                "as_of": "2026-08-19",
            }),
            patch.object(api, "_cache_set") as cache_set,
            patch.object(api, "_publish_cache") as publish,
        ):
            payload = api.get_market_sentiment(Response())

        publish.assert_not_called()
        self.assertIn(
            call("market_sentiment_v2", payload["data"], api.RECOVERY_CACHE_TTL),
            cache_set.call_args_list,
        )
        self.assertIn(
            call("recovery_gate:market_sentiment_v2", {"active": True}, api.RECOVERY_CACHE_TTL),
            cache_set.call_args_list,
        )
        self.assertEqual(payload["source"], "partial")
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["data"]["available_fields"], 6)
        self.assertEqual(payload["data"]["fresh_fields"], 5)
        self.assertEqual(payload["data"]["nasdaq_pe"], qqq_reference)

    def test_true_cold_follower_does_not_start_market_provider_pool(self):
        held = api._try_recovery_refresh("market_sentiment_v2")
        self.assertIsNotNone(held)
        try:
            with (
                patch.object(api, "_mem_get", return_value=None),
                patch.object(api, "_lkg_get", return_value=None),
                patch.object(api, "ThreadPoolExecutor") as pool,
            ):
                payload = api.get_market_sentiment(Response())
        finally:
            held.release()

        pool.assert_not_called()
        self.assertEqual(payload["source"], "refresh_in_progress")


class MonthlyReturnRouteContractTests(unittest.TestCase):
    def test_cached_partial_attempts_recovery_and_uses_short_ttl_if_still_partial(self):
        cached = {"months": [{"month": "2026-07"}], "status": "partial"}
        recovered = {"months": [{"month": "2026-07"}], "status": "partial", "as_of": "2026-08-19"}
        with (
            patch.object(
                api,
                "_cache_get",
                side_effect=lambda key: cached if key == "monthly_returns_v1" else None,
            ),
            patch.object(api, "_monthly_return_payload", return_value=recovered) as build,
            patch.object(api, "_cache_set") as cache_set,
            patch.object(api, "_publish_cache") as publish,
        ):
            payload = api.get_monthly_returns(Response())

        build.assert_called_once_with()
        publish.assert_not_called()
        self.assertIn(call("monthly_returns_v1", recovered, api.RECOVERY_CACHE_TTL), cache_set.call_args_list)
        self.assertIn(
            call("recovery_gate:monthly_returns_v1", {"active": True}, api.RECOVERY_CACHE_TTL),
            cache_set.call_args_list,
        )
        self.assertEqual(payload["source"], "partial")
        self.assertEqual(payload["status"], "partial")

    def test_true_cold_follower_does_not_duplicate_monthly_builder(self):
        held = api._try_recovery_refresh("monthly_returns_v1")
        self.assertIsNotNone(held)
        try:
            with (
                patch.object(api, "_cache_get", return_value=None),
                patch.object(api, "_lkg_get", return_value=None),
                patch.object(api, "_monthly_return_payload") as build,
            ):
                payload = api.get_monthly_returns(Response())
        finally:
            held.release()

        build.assert_not_called()
        self.assertEqual(payload["source"], "refresh_in_progress")


class CronRefreshContractTests(unittest.TestCase):
    def test_combined_fund_cron_is_disabled_to_protect_30_second_budget(self):
        with (
            patch.object(api, "_require_job_secret"),
            patch.object(api, "_build_funds") as build,
        ):
            with self.assertRaises(HTTPException) as raised:
                api.cron_refresh(None)

        self.assertEqual(raised.exception.status_code, 410)
        build.assert_not_called()

    def test_split_fund_cron_requires_successful_redis_publish(self):
        with (
            patch.object(api, "STATIC_FUNDS", {"us_active": [{"code": "x"}]}),
            patch.object(api, "_build_funds", return_value=([{"code": "x"}], "live")),
            patch.object(api, "_store_snapshot", return_value=False),
        ):
            with self.assertRaises(HTTPException) as raised:
                api._refresh_fund_category("us_active")

        self.assertEqual(raised.exception.status_code, 503)
        self.assertFalse(raised.exception.detail["published"])

    def test_etf_cron_rejects_intraday_execution(self):
        with (
            patch.object(api, "_require_job_secret"),
            patch.object(api, "_china_now", return_value=datetime(2026, 8, 20, 10, 30, tzinfo=timezone(timedelta(hours=8)))),
            patch.object(api, "_acquire_job_lock") as lock,
            patch.object(api, "_build_etfs") as build,
        ):
            with self.assertRaises(HTTPException) as raised:
                api.cron_etfs(None)

        self.assertEqual(raised.exception.status_code, 409)
        lock.assert_not_called()
        build.assert_not_called()

    def test_etf_cron_reports_publish_failure_as_non_2xx(self):
        with (
            patch.object(api, "_require_job_secret"),
            patch.object(api, "_china_now", return_value=datetime(2026, 8, 20, 15, 30, tzinfo=timezone(timedelta(hours=8)))),
            patch.object(api, "_acquire_job_lock", return_value="run-token"),
            patch.object(api, "_release_job_lock") as release,
            patch.object(api, "_build_etfs", return_value=([{"code": "513100"}], "live")),
            patch.object(api, "_store_snapshot", return_value=False),
        ):
            with self.assertRaises(HTTPException) as raised:
                api.cron_etfs(None)

        self.assertEqual(raised.exception.status_code, 503)
        self.assertFalse(raised.exception.detail["published"])
        release.assert_called_once_with("etfs:close", "run-token")


class PeHistoryContractTests(unittest.TestCase):
    @staticmethod
    def _estimated_data():
        return {
            "sp500": [{
                "date": "2026-07",
                "pe": 29.7,
                "quality": "estimated",
                "source": "embedded_annual_interpolation",
            }],
            "nasdaq100": [{
                "date": "2026-07",
                "pe": 31.5,
                "quality": "estimated",
                "source": "embedded_annual_interpolation",
            }],
        }

    def test_estimated_history_is_labeled_reference_and_partial(self):
        rows = self._estimated_data()
        with (
            patch.object(api, "_mem_get", return_value=None),
            patch.object(api, "fetch_sp500_pe_history", return_value=rows["sp500"]),
            patch.object(api, "fetch_nasdaq100_pe_history", return_value=rows["nasdaq100"]),
            patch.object(api, "_publish_cache") as publish,
        ):
            payload = api.get_pe_history(Response())

        publish.assert_called_once()
        self.assertEqual(payload["source"], "reference")
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["data"]["meta"]["usage"], "reference_only_not_for_percentile")
        self.assertTrue(payload["data"]["meta"]["sp500"]["contains_estimates"])
        self.assertTrue(payload["data"]["meta"]["nasdaq100"]["contains_estimates"])

    def test_cached_estimated_history_remains_partial(self):
        data = self._estimated_data()
        data["meta"] = {
            "sp500": {"contains_estimates": True},
            "nasdaq100": {"contains_estimates": True},
            "usage": "reference_only_not_for_percentile",
        }
        with patch.object(api, "_mem_get", return_value=data):
            payload = api.get_pe_history(Response())

        self.assertEqual(payload["source"], "cache")
        self.assertEqual(payload["status"], "partial")


if __name__ == "__main__":
    unittest.main()
