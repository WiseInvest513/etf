import copy
import importlib.util
import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "products.v1.json"
BUILDER_PATH = ROOT / "scripts" / "build_product_catalog.py"

spec = importlib.util.spec_from_file_location("build_product_catalog", BUILDER_PATH)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


class ProductCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        cls.products = cls.catalog["products"]
        cls.by_code = {product["code"]: product for product in cls.products}

    def test_catalog_passes_offline_validator_and_matches_sources(self):
        summary = builder.validate_catalog(self.catalog)
        self.assertEqual(summary["products"], len(self.products))
        rebuilt = builder.build_catalog(
            ROOT / "api" / "index.py",
            ROOT / "src" / "App.jsx",
            metadata_as_of=self.catalog["metadata_as_of"],
        )
        self.assertEqual(
            builder.identity_projection(rebuilt),
            builder.identity_projection(self.catalog),
        )

    def test_formal_schema_rejects_unknown_properties_and_impossible_dates(self):
        unknown = copy.deepcopy(self.catalog)
        unknown["unexpected"] = True
        with self.assertRaisesRegex(builder.CatalogError, "Additional properties"):
            builder.validate_catalog(unknown)

        invalid_date = copy.deepcopy(self.catalog)
        invalid_date["metadata_as_of"] = "2026-99-99"
        with self.assertRaisesRegex(builder.CatalogError, "is not a 'date'"):
            builder.validate_catalog(invalid_date)

    def test_formal_schema_requires_at_least_one_product(self):
        empty = copy.deepcopy(self.catalog)
        empty["products"] = []
        with self.assertRaisesRegex(builder.CatalogError, "should be non-empty"):
            builder.validate_catalog(empty)

    def test_bootstrap_write_refuses_to_replace_existing_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            original = CATALOG_PATH.read_bytes()
            path.write_bytes(original)

            with redirect_stderr(io.StringIO()):
                result = builder.main(["--write", "--catalog", str(path)])

            self.assertEqual(result, 1)
            self.assertEqual(path.read_bytes(), original)

    def test_bootstrap_write_creates_missing_catalog_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "products.v1.json"
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                result = builder.main([
                    "--write",
                    "--catalog",
                    str(path),
                    "--as-of",
                    "2026-08-20",
                ])

            self.assertEqual(result, 0)
            created = builder.load_catalog(path)
            self.assertEqual(created["metadata_as_of"], "2026-08-20")
            self.assertEqual(
                builder.identity_projection(created),
                builder.identity_projection(self.catalog),
            )

    def test_product_codes_are_unique_six_digit_strings(self):
        codes = [product["code"] for product in self.products]
        self.assertEqual(len(codes), len(set(codes)))
        for code in codes:
            self.assertIsInstance(code, str)
            self.assertRegex(code, r"^[0-9]{6}$")

    def test_categories_are_known_and_match_product_type(self):
        allowed = set(builder.ALLOWED_CATEGORIES)
        for product in self.products:
            categories = product["categories"]
            self.assertTrue(categories)
            self.assertTrue(set(categories) <= allowed)
            expected_type = "etf" if "etfs" in categories else "fund"
            self.assertEqual(product["product_type"], expected_type)

    def test_leading_zero_codes_are_preserved(self):
        self.assertIn("019524", self.by_code)
        self.assertEqual(self.by_code["019524"]["code"], "019524")
        self.assertTrue(any(product["code"].startswith("0") for product in self.products))

    def test_ac_references_are_well_formed_and_internal_masters_exist(self):
        code_pattern = re.compile(r"^[0-9]{6}$")
        for product in self.products:
            code = product["code"]
            master = product["master_code"]
            if master is not None:
                self.assertIsInstance(master, str)
                self.assertRegex(master, code_pattern)
                self.assertIn(master, self.by_code)
            else:
                self.assertEqual(product["share_class"], "C")
            if product["share_class"] == "C" and master is not None:
                self.assertNotEqual(master, code)
            for related in product["related_share_codes"]:
                self.assertIsInstance(related, str)
                self.assertRegex(related, code_pattern)
                self.assertNotEqual(related, code)
                if related in self.by_code:
                    self.assertIn(code, self.by_code[related]["related_share_codes"])


if __name__ == "__main__":
    unittest.main()
