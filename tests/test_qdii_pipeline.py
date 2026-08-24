import unittest
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Response

import api.index as api


class QDIIHoldingParserTests(unittest.TestCase):
    def test_weight_comes_from_header_not_low_stock_price(self):
        html = """
        <table>
          <tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>最新价</th>
              <th>涨跌幅</th><th>相关资讯</th><th>占净值比例</th></tr>
          <tr><td>1</td><td><a href='/unify/r/105.TEST'>TEST</a></td><td>Test</td>
              <td>12.00</td><td>1.2%</td><td>行情</td><td>3.54%</td></tr>
        </table>
        """
        rows = api._parse_em_holdings_table(html)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["symbol"], "TEST")
        self.assertEqual(rows[0]["weight"], 3.54)


class QDIISnapshotTests(unittest.TestCase):
    def _quotes(self, status="fresh"):
        now = datetime.now(ZoneInfo("America/New_York"))
        market_date = now.date().isoformat()
        as_of = now.isoformat(timespec="seconds")
        base = {
            "regular_return_pct": 10.0,
            "live_return_pct": 10.0,
            "currency": "USD",
            "data_status": status,
            "market_state": "CLOSED",
            "regular_market_date": market_date,
            "regular_as_of": as_of,
            "live_as_of": as_of,
            "exchange_timezone": "America/New_York",
        }
        fx = {
            "regular_return_pct": 1.0,
            "live_return_pct": 1.0,
            "data_status": status,
            "market_state": "REGULAR",
            "regular_price": 7.0,
            "regular_market_date": market_date,
            "regular_as_of": as_of,
            "live_as_of": as_of,
            "exchange_timezone": "America/New_York",
        }
        return {"NVDA": base, "USDCNY=X": fx}

    def test_snapshot_compounds_fx_and_shares_master_portfolio(self):
        products = [
            {"code": "A", "name": "Fund A", "master_code": "A", "scale": 1, "annual_return_2025": 2},
            {"code": "C", "name": "Fund C", "master_code": "A", "scale": 1, "annual_return_2025": 2},
        ]
        holdings = {
            "status": "fresh",
            "updated_at": "2026-08-22T00:00:00+00:00",
            "portfolios": {
                "A": {
                    "report_date": "2026-06-30",
                    "source": "test",
                    "holdings": [{"symbol": "NVDA", "weight": 20}],
                }
            },
        }
        with patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "QDII_V3_CODES", ["A", "C"]), \
             patch.object(api, "_cache_get", return_value=[]), \
             patch.object(api, "_lkg_get", return_value=[]), \
             patch.object(api, "_qdii_session_from_quotes", return_value="a_share"):
            snapshot = api._qdii_v3_snapshot_from_quotes(self._quotes(), holdings, "run-1")
        self.assertEqual(snapshot["status"], "fresh")
        self.assertEqual(len(snapshot["funds"]), 2)
        self.assertAlmostEqual(snapshot["funds"][0]["close_valuation"], 2.22)
        self.assertIsNone(snapshot["funds"][0]["live_valuation"])
        self.assertEqual(snapshot["funds"][0]["valuation_label"], "上一交易日收盘估值")
        self.assertEqual(snapshot["funds"][1]["holdings_date"], "2026-06-30")

    def test_us_open_exposes_only_intraday_valuation_and_previous_close_changes(self):
        products = [{"code": "A", "name": "Fund A", "master_code": "A"}]
        holdings = {
            "portfolios": {
                "A": {
                    "report_date": "2026-06-30",
                    "source": "test",
                    "holdings": [{"symbol": "NVDA", "name": "Nvidia", "weight": 20}],
                }
            }
        }
        with patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "QDII_V3_CODES", ["A"]), \
             patch.object(api, "_cache_get", return_value=[]), \
             patch.object(api, "_lkg_get", return_value=[]), \
             patch.object(api, "_qdii_session_from_quotes", return_value="us_open"):
            snapshot = api._qdii_v3_snapshot_from_quotes(self._quotes(), holdings, "run-open")

        fund = snapshot["funds"][0]
        self.assertEqual(snapshot["valuation_kind"], "intraday")
        self.assertIsNotNone(snapshot["market_as_of"])
        self.assertAlmostEqual(fund["valuation"], 2.22)
        self.assertIsNone(fund["close_valuation"])
        self.assertAlmostEqual(fund["live_valuation"], 2.22)
        self.assertIsNone(fund["holdings"][0]["close_change"])
        self.assertEqual(fund["holdings"][0]["change"], 10.0)
        self.assertEqual(fund["holdings"][0]["change_basis"], "previous_close")

    def test_post_market_exposes_close_and_post_market_reference(self):
        products = [{"code": "A", "name": "Fund A", "master_code": "A"}]
        holdings = {
            "portfolios": {
                "A": {"holdings": [{"symbol": "NVDA", "weight": 20}]}
            }
        }
        with patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "QDII_V3_CODES", ["A"]), \
             patch.object(api, "_cache_get", return_value=[]), \
             patch.object(api, "_lkg_get", return_value=[]), \
             patch.object(api, "_qdii_session_from_quotes", return_value="post_market"):
            snapshot = api._qdii_v3_snapshot_from_quotes(self._quotes(), holdings, "run-post")

        fund = snapshot["funds"][0]
        self.assertAlmostEqual(fund["close_valuation"], 2.22)
        self.assertAlmostEqual(fund["live_valuation"], 2.22)
        self.assertEqual(fund["holdings"][0]["close_change"], 10.0)
        self.assertEqual(fund["holdings"][0]["change"], 10.0)

    def test_undated_fallback_quote_cannot_make_snapshot_fresh(self):
        products = [{"code": "A", "name": "Fund A", "master_code": "A"}]
        holdings = {
            "portfolios": {"A": {"holdings": [{"symbol": "NVDA", "weight": 20}]}}
        }
        with patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "QDII_V3_CODES", ["A"]), \
             patch.object(api, "_cache_get", return_value=[]), \
             patch.object(api, "_lkg_get", return_value=[]):
            snapshot = api._qdii_v3_snapshot_from_quotes(self._quotes(status="partial"), holdings, "run-2")
        self.assertEqual(snapshot["status"], "partial")
        self.assertEqual(snapshot["fresh_quote_coverage"], 0)

    def test_missing_catalog_fund_keeps_dataset_partial(self):
        products = [
            {"code": "A", "name": "Fund A", "master_code": "A"},
            {"code": "B", "name": "Fund B", "master_code": "B"},
        ]
        holdings = {
            "portfolios": {"A": {"holdings": [{"symbol": "NVDA", "weight": 20}]}}
        }
        with patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "QDII_V3_CODES", ["A", "B"]), \
             patch.object(api, "_cache_get", return_value=[]), \
             patch.object(api, "_lkg_get", return_value=[]):
            snapshot = api._qdii_v3_snapshot_from_quotes(self._quotes(), holdings, "run-3")
        self.assertEqual(snapshot["fund_coverage"], 0.5)
        self.assertEqual(snapshot["status"], "partial")

    def test_declared_fof_is_visible_but_does_not_block_estimable_snapshot(self):
        products = [
            {"code": "A", "name": "Fund A", "master_code": "A"},
            {"code": "FOF", "name": "Fund of Funds", "master_code": "FOF"},
        ]
        holdings = {
            "portfolios": {"A": {"holdings": [{"symbol": "NVDA", "weight": 20}]}}
        }
        with patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "QDII_V3_CODES", ["A", "FOF"]), \
             patch.object(api, "QDII_V3_UNSUPPORTED_MASTER_CODES", {"FOF": "fund_of_funds"}), \
             patch.object(api, "_cache_get", return_value=[]), \
             patch.object(api, "_lkg_get", return_value=[]):
            snapshot = api._qdii_v3_snapshot_from_quotes(self._quotes(), holdings, "run-4")
        self.assertEqual(snapshot["status"], "fresh")
        self.assertEqual(snapshot["fund_coverage"], 1.0)
        fof = next(row for row in snapshot["funds"] if row["code"] == "FOF")
        self.assertEqual(fof["estimation_status"], "unsupported_fund_of_funds")
        self.assertIsNone(fof["close_valuation"])


class QDIIPublicRouteTests(unittest.TestCase):
    def test_public_valuation_route_only_reads_snapshot(self):
        snapshot = {"schema_version": "3", "status": "fresh", "funds": [{"code": "A"}]}
        with patch.object(api, "_cache_get", return_value=snapshot), \
             patch.object(api, "_yf_batch_quote_rows") as upstream:
            result = api.api_qdii_valuations(Response())
        self.assertEqual(result, snapshot)
        upstream.assert_not_called()

    def test_public_route_does_not_rebuild_when_no_snapshot_exists(self):
        with patch.object(api, "_cache_get", return_value=None), \
             patch.object(api, "_lkg_get", return_value=None), \
             patch.object(api, "_yf_batch_quote_rows") as upstream:
            result = api.api_qdii_valuations(Response())
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["funds"], [])
        upstream.assert_not_called()

    def test_complete_lkg_is_preferred_over_newer_partial_diagnostic(self):
        lkg = {"schema_version": "3", "status": "fresh", "funds": [{"code": "A"}]}
        partial = {"schema_version": "3", "status": "partial", "funds": [{"code": "B"}]}

        def cache_get(key):
            if key == api.QDII_V3_PARTIAL_VALUATIONS_KEY:
                return partial
            return None

        with patch.object(api, "_cache_get", side_effect=cache_get), \
             patch.object(api, "_lkg_get", return_value=lkg):
            result = api.api_qdii_valuations(Response())
        self.assertEqual(result["status"], "stale")
        self.assertEqual(result["funds"], [{"code": "A"}])

    def test_public_holdings_force_parameter_never_calls_provider(self):
        products = [{"code": "A", "name": "Fund A", "master_code": "A"}]
        payload = {
            "status": "fresh",
            "portfolios": {
                "A": {
                    "report_date": "2026-06-30",
                    "source": "test",
                    "holdings": [{"symbol": "NVDA", "weight": 10}],
                }
            },
        }
        with patch.object(api, "QDII_V3_CODES", ["A"]), \
             patch.object(api, "QDII_V3_PRODUCTS", products), \
             patch.object(api, "_qdii_v3_holdings_payload", return_value=payload), \
             patch.object(api, "_qdii_verified_latest_portfolio") as upstream:
            result = api.api_qdii_holdings("A", Response(), force=True)
        self.assertEqual(result["status"], "fresh")
        upstream.assert_not_called()


class QDIIHoldingCronTests(unittest.TestCase):
    def test_holdings_cron_refreshes_only_its_bounded_batch(self):
        portfolio = {
            "master_code": "A",
            "report_date": "2026-06-30",
            "source": "test",
            "holdings": [{"symbol": "NVDA", "weight": 10}],
        }
        with patch.object(api, "QDII_V3_MASTER_CODES", ["A", "B", "C", "D"]), \
             patch.object(api, "_require_job_secret"), \
             patch.object(api, "_acquire_job_lock", return_value="token"), \
             patch.object(api, "_release_job_lock"), \
             patch.object(api, "_qdii_v3_holdings_payload", return_value={}), \
             patch.object(api, "_qdii_verified_latest_portfolio", return_value=portfolio) as fetcher, \
             patch.object(api, "_publish_cache", return_value=True):
            result = api.cron_qdii_holdings(0, authorization="Bearer test")
        self.assertTrue(result["ok"])
        self.assertEqual(result["selected"], ["A"])
        fetcher.assert_called_once_with("A")


class QDIIQuoteCronTests(unittest.TestCase):
    def _holdings(self):
        return {
            "status": "fresh",
            "portfolios": {
                "A": {
                    "report_date": "2026-06-30",
                    "holdings": [{"symbol": "NVDA", "weight": 10}],
                }
            },
        }

    def test_partial_snapshot_never_overwrites_permanent_lkg(self):
        partial = {
            "status": "partial",
            "session": "weekend",
            "quote_count": 1,
            "required_quote_count": 1,
            "fresh_quote_coverage": 0.0,
            "fund_coverage": 1.0,
        }
        with patch.object(api, "_require_job_secret"), \
             patch.object(api, "_acquire_job_lock", return_value="token"), \
             patch.object(api, "_release_job_lock"), \
             patch.object(api, "_qdii_v3_holdings_payload", return_value=self._holdings()), \
             patch.object(api, "_yf_batch_quote_rows", return_value={"NVDA": {}}), \
             patch.object(api, "_qdii_fill_missing_quotes", side_effect=lambda symbols, quotes, deadline=None: quotes), \
             patch.object(api, "_qdii_v3_snapshot_from_quotes", return_value=partial), \
             patch.object(api, "_cache_set", return_value=True) as cache_set, \
             patch.object(api, "_publish_cache", return_value=True) as publish, \
             patch.object(api, "_lkg_set", return_value=True) as lkg_set:
            with self.assertRaises(HTTPException) as raised:
                api.cron_qdii_quotes(authorization="Bearer test")
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(cache_set.call_count, 2)
        self.assertEqual(cache_set.call_args_list[1].args[0], api.QDII_V3_PARTIAL_VALUATIONS_KEY)
        publish.assert_not_called()
        lkg_set.assert_not_called()

    def test_redis_publish_failure_is_visible_to_scheduler(self):
        fresh = {
            "status": "fresh",
            "session": "weekend",
            "quote_count": 1,
            "required_quote_count": 1,
            "fresh_quote_coverage": 1.0,
            "fund_coverage": 1.0,
        }
        with patch.object(api, "_require_job_secret"), \
             patch.object(api, "_acquire_job_lock", return_value="token"), \
             patch.object(api, "_release_job_lock"), \
             patch.object(api, "_qdii_v3_holdings_payload", return_value=self._holdings()), \
             patch.object(api, "_yf_batch_quote_rows", return_value={"NVDA": {}}), \
             patch.object(api, "_qdii_fill_missing_quotes", side_effect=lambda symbols, quotes, deadline=None: quotes), \
             patch.object(api, "_qdii_v3_snapshot_from_quotes", return_value=fresh), \
             patch.object(api, "_cache_set", return_value=False), \
             patch.object(api, "_publish_cache", return_value=True), \
             patch.object(api, "_lkg_set", return_value=True), \
             patch.object(api, "_cache_delete"):
            with self.assertRaises(HTTPException) as raised:
                api.cron_qdii_quotes(authorization="Bearer test")
        self.assertEqual(raised.exception.status_code, 503)

    def test_expired_global_deadline_does_not_start_provider_calls(self):
        with patch.object(api.time, "monotonic", return_value=100.0), \
             patch.object(api, "_get") as get:
            result = api._yf_batch_quote_rows(["NVDA"], deadline=99.0)
        self.assertEqual(result, {})
        get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
