import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date
from pathlib import Path
from unittest import mock

from scripts import refresh_catalog_metadata as refresh
from scripts.build_product_catalog import CatalogError, load_catalog, write_catalog_atomic


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "products.v1.json"


def _catalog():
    return load_catalog(CATALOG_PATH)


def _successful_update(product):
    snapshot = product["static_snapshot"]
    needs_tracking = refresh._needs_tracking(product)
    tracking = snapshot.get("track_error")
    if needs_tracking and tracking is None:
        tracking = 1.0
    return {
        "code": product["code"],
        "scale": snapshot["scale"],
        "scale_as_of": snapshot.get("scale_as_of") or "2026-06-30",
        "annual_return_2025": snapshot["annual_return_2025"],
        "track_error": tracking,
        "track_error_as_of": (
            snapshot.get("track_error_as_of") or "2026-08-18"
        ) if needs_tracking else None,
        "track_error_expected": needs_tracking,
        "field_errors": {},
    }


class RefreshParserTests(unittest.TestCase):
    def test_asset_metadata_requires_positive_value_and_real_report_date(self):
        valid = (
            'Data_assetAllocation = {"categories":["2026-03-31","2026-06-30"],'
            '"series":[{"name":"净资产","data":[0,12.345]}]};'
        )
        self.assertEqual(refresh._asset_metadata(valid), (12.35, "2026-06-30"))

        invalid_date = valid.replace("2026-06-30", "2026-99-99")
        self.assertEqual(refresh._asset_metadata(invalid_date), (None, None))
        self.assertEqual(
            refresh._asset_metadata(
                'Data_assetAllocation = {"categories":["2026-06-30"],'
                '"series":[{"name":"净资产","data":[0]}]};'
            ),
            (None, None),
        )

    def test_tracking_parser_selects_index_row_and_keeps_disclosure_date(self):
        html = """
            <label>净资产规模：48.87亿元（截止至：2026-06-30）</label>
            <table>
              <tr><th>跟踪指数</th><th><span>年化跟踪误差</span></th>
                  <th>同类平均跟踪误差</th></tr>
              <tr><td>纳斯达克100指数</td><td><strong> 1.27 %</strong></td>
                  <td>0.62%</td></tr>
            </table>
            <p>数据截止至：<span>2026/8/18</span></p>
        """
        self.assertEqual(refresh._tracking_metadata(html), (1.27, "2026-08-18"))
        self.assertEqual(refresh._tracking_error(html), 1.27)

    def test_tracking_parser_never_fabricates_a_missing_disclosure_date(self):
        html = "<table><tr><th>年化跟踪误差</th><td>指数</td><td>1.17%</td></tr></table>"
        self.assertEqual(refresh._tracking_metadata(html), (1.17, None))

    def test_refresh_one_uses_f10_and_keeps_tracking_if_ping_request_fails(self):
        product = next(item for item in _catalog()["products"] if refresh._needs_tracking(item))
        requested = []

        def fake_fetch(url):
            requested.append(url)
            if "pingzhongdata" in url:
                raise RuntimeError("ping unavailable")
            return (
                "<table><tr><th>跟踪指数</th><th>年化跟踪误差</th>"
                "</tr><tr><td>纳斯达克100指数</td><td>1.17%</td></tr>"
                "</table><p>截止至：2026-08-18</p>"
            )

        with mock.patch.object(refresh, "_fetch_text", side_effect=fake_fetch):
            result = refresh._refresh_one(product)

        self.assertFalse(result["ping_fetched"])
        self.assertIsNone(result["scale"])
        self.assertEqual(result["track_error"], 1.17)
        self.assertEqual(result["track_error_as_of"], "2026-08-18")
        self.assertIn("pingzhongdata", requested[0])
        self.assertEqual(
            requested[1],
            f"https://fundf10.eastmoney.com/tsdata_{product['code']}.html",
        )


class RefreshCatalogTests(unittest.TestCase):
    def test_tracking_snapshot_uses_upstream_date_and_migrates_source_label(self):
        catalog = _catalog()
        target = next(item for item in catalog["products"] if refresh._needs_tracking(item))

        with mock.patch.object(refresh, "_refresh_one", side_effect=_successful_update):
            refreshed, summary = refresh.refresh_catalog(
                catalog,
                workers=4,
                checked_on=date(2026, 8, 21),
            )

        row = next(item for item in refreshed["products"] if item["code"] == target["code"])
        self.assertEqual(row["static_snapshot"]["track_error_as_of"], "2026-08-18")
        self.assertEqual(row["static_snapshot"]["metadata_fetched_at"], "2026-08-21")
        self.assertEqual(summary["field_coverage"]["track_error"], 1.0)
        self.assertIn(refresh.CATALOG_SOURCE, refreshed["source"])
        self.assertNotIn(refresh.LEGACY_CATALOG_SOURCE, refreshed["source"])

    def test_older_scale_report_cannot_replace_newer_snapshot(self):
        catalog = _catalog()
        target = catalog["products"][0]
        original_scale = target["static_snapshot"]["scale"]

        def fake(product):
            result = _successful_update(product)
            if product["code"] == target["code"]:
                result["scale"] = original_scale + 1
                result["scale_as_of"] = "2026-03-31"
            return result

        with mock.patch.object(refresh, "_refresh_one", side_effect=fake):
            refreshed, summary = refresh.refresh_catalog(
                catalog,
                workers=4,
                checked_on=date(2026, 8, 21),
            )

        row = next(item for item in refreshed["products"] if item["code"] == target["code"])
        self.assertEqual(row["static_snapshot"]["scale"], original_scale)
        self.assertIn(f"{target['code']}.scale", summary["anomalies"])

    def test_missing_field_preserves_lkg_and_is_counted_in_field_coverage(self):
        catalog = _catalog()
        target = catalog["products"][0]
        original_scale = target["static_snapshot"]["scale"]
        original_date = target["static_snapshot"]["scale_as_of"]

        def fake(product):
            result = _successful_update(product)
            if product["code"] == target["code"]:
                result["scale"] = None
                result["scale_as_of"] = None
                result["field_errors"] = {"scale": "missing in fixture"}
            return result

        with mock.patch.object(refresh, "_refresh_one", side_effect=fake):
            refreshed, summary = refresh.refresh_catalog(
                catalog,
                workers=4,
                checked_on=date(2026, 8, 21),
            )

        row = next(item for item in refreshed["products"] if item["code"] == target["code"])
        self.assertEqual(row["static_snapshot"]["scale"], original_scale)
        self.assertEqual(row["static_snapshot"]["scale_as_of"], original_date)
        self.assertEqual(summary["field_updates"]["scale"], summary["total"] - 1)
        self.assertEqual(summary["field_errors"][target["code"]]["scale"], "missing in fixture")
        self.assertEqual(refresh.refresh_quality_issues(summary), [])

    def test_all_requests_can_succeed_while_field_coverage_blocks_write(self):
        catalog = _catalog()

        def empty_result(product):
            needs_tracking = refresh._needs_tracking(product)
            errors = {
                "scale": "parser drift",
                "annual_return_2025": "parser drift",
            }
            if needs_tracking:
                errors["track_error"] = "parser drift"
            return {
                "code": product["code"],
                "scale": None,
                "scale_as_of": None,
                "annual_return_2025": None,
                "track_error": None,
                "track_error_expected": needs_tracking,
                "field_errors": errors,
            }

        with mock.patch.object(refresh, "_refresh_one", side_effect=empty_result):
            _, summary = refresh.refresh_catalog(catalog, workers=4)

        self.assertEqual(summary["fetched"], summary["total"])
        self.assertEqual(summary["field_coverage"]["scale"], 0)
        self.assertEqual(summary["field_coverage"]["annual_return_2025"], 0)
        issues = refresh.refresh_quality_issues(summary)
        self.assertTrue(any("scale coverage" in issue for issue in issues))
        self.assertTrue(any("annual_return_2025 coverage" in issue for issue in issues))
        self.assertFalse(any("fetch coverage" in issue for issue in issues))

    def test_outlier_is_preserved_and_requires_manual_review(self):
        catalog = _catalog()
        target = catalog["products"][0]
        original_scale = target["static_snapshot"]["scale"]

        def fake(product):
            result = _successful_update(product)
            if product["code"] == target["code"]:
                result["scale"] = original_scale * 100
            return result

        with mock.patch.object(refresh, "_refresh_one", side_effect=fake):
            refreshed, summary = refresh.refresh_catalog(catalog, workers=4)

        row = next(item for item in refreshed["products"] if item["code"] == target["code"])
        self.assertEqual(row["static_snapshot"]["scale"], original_scale)
        self.assertIn(f"{target['code']}.scale", summary["anomalies"])
        self.assertTrue(any("manual review" in issue for issue in refresh.refresh_quality_issues(summary)))

    def test_finalized_2025_return_cannot_silently_change(self):
        catalog = _catalog()
        target = catalog["products"][0]
        original = target["static_snapshot"]["annual_return_2025"]

        def fake(product):
            result = _successful_update(product)
            if product["code"] == target["code"]:
                result["annual_return_2025"] = original + 1.0
            return result

        with mock.patch.object(refresh, "_refresh_one", side_effect=fake):
            refreshed, summary = refresh.refresh_catalog(catalog, workers=4)

        row = next(item for item in refreshed["products"] if item["code"] == target["code"])
        self.assertEqual(row["static_snapshot"]["annual_return_2025"], original)
        self.assertIn(f"{target['code']}.annual_return_2025", summary["anomalies"])

    def test_cli_low_coverage_never_replaces_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            original = CATALOG_PATH.read_bytes()
            path.write_bytes(original)

            def empty_result(product):
                return {
                    "code": product["code"],
                    "scale": None,
                    "scale_as_of": None,
                    "annual_return_2025": None,
                    "track_error": None,
                    "track_error_expected": refresh._needs_tracking(product),
                    "field_errors": {"scale": "missing"},
                }

            with mock.patch.object(refresh, "_refresh_one", side_effect=empty_result):
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    result = refresh.main(["--catalog", str(path), "--write", "--workers", "2"])

            self.assertEqual(result, 1)
            self.assertEqual(path.read_bytes(), original)


class AtomicCatalogWriteTests(unittest.TestCase):
    def test_valid_catalog_is_replaced_and_temporary_file_is_removed(self):
        catalog = _catalog()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            write_catalog_atomic(path, catalog)

            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), catalog)
            self.assertEqual(list(path.parent.glob(f".{path.name}.*.tmp")), [])

    def test_invalid_catalog_never_replaces_last_good_file(self):
        catalog = _catalog()
        invalid = copy.deepcopy(catalog)
        invalid["metadata_as_of"] = "2026-99-99"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            path.write_text("last-known-good\n", encoding="utf-8")

            with self.assertRaises(CatalogError):
                write_catalog_atomic(path, invalid)

            self.assertEqual(path.read_text(encoding="utf-8"), "last-known-good\n")

    def test_no_replace_mode_closes_bootstrap_check_write_race(self):
        catalog = _catalog()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            path.write_text("refreshed-between-check-and-write\n", encoding="utf-8")

            with self.assertRaisesRegex(CatalogError, "refusing to overwrite"):
                write_catalog_atomic(path, catalog, replace_existing=False)

            self.assertEqual(
                path.read_text(encoding="utf-8"),
                "refreshed-between-check-and-write\n",
            )
            self.assertEqual(list(path.parent.glob(f".{path.name}.*.tmp")), [])

    def test_rename_failure_preserves_lkg_and_removes_temporary_file(self):
        catalog = _catalog()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            path.write_text("last-known-good\n", encoding="utf-8")

            with mock.patch.object(Path, "replace", side_effect=OSError("rename failed")):
                with self.assertRaisesRegex(OSError, "rename failed"):
                    write_catalog_atomic(path, catalog)

            self.assertEqual(path.read_text(encoding="utf-8"), "last-known-good\n")
            self.assertEqual(list(path.parent.glob(f".{path.name}.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
