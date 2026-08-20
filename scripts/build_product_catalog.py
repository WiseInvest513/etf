#!/usr/bin/env python3
"""Build and validate the offline WiseETF product catalog.

The migration input is intentionally limited to repository files:

* ``api/index.py``: ``STATIC_FUNDS`` and ``STATIC_ETFS`` via Python AST
* ``src/App.jsx``: ``FALLBACK`` via a constrained JS-literal -> Python-literal
  conversion followed by ``ast.literal_eval``

No application module is imported and no network request is made. When a code
exists in both sources, backend values win; frontend-only products are retained.
After the initial bootstrap, the catalog becomes the canonical metadata source.
The default mode validates it and checks only product identity/category drift;
refreshed scale, annual return and tracking-error metadata are intentionally not
compared with the legacy literals.
"""

from __future__ import annotations

import argparse
import ast
import json
import math
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Iterable

try:
    from jsonschema import Draft202012Validator, FormatChecker
    from jsonschema.exceptions import SchemaError
except ImportError:  # pragma: no cover - exercised by the deployment environment
    Draft202012Validator = None
    FormatChecker = None
    SchemaError = Exception


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKEND = ROOT / "api" / "index.py"
DEFAULT_FRONTEND = ROOT / "src" / "App.jsx"
DEFAULT_CATALOG = ROOT / "catalog" / "products.v1.json"
DEFAULT_SCHEMA = ROOT / "catalog" / "products.schema.json"

ALLOWED_CATEGORIES = ("nasdaq_passive", "sp500_passive", "us_active", "etfs")
CODE_RE = re.compile(r"^[0-9]{6}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

BACKEND_FUNDS_AS_OF = "2026-04-09"
BACKEND_ETFS_AS_OF = "2026-04-02"

SNAPSHOT_FIELDS = (
    "annual_return_2025",
    "scale",
    "fee",
    "track_error",
    "daily_limit",
    "subscription_status",
    "premium",
    "volume",
    "change_pct",
    "market_price",
    "nav",
)

DIFF_FIELDS = (
    "name",
    "fee_rate",
    "scale",
    "ytd_return",
    "track_error",
    "daily_limit",
    "buy_status",
    "code_c",
    "tracking_index",
    "premium",
    "volume",
    "change_pct",
    "market_price",
    "nav",
)


class CatalogError(ValueError):
    """Raised when a source or generated catalog violates the contract."""


def _assignment_value(module: ast.Module, name: str) -> Any:
    for node in module.body:
        target = None
        value = None
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target, value = node.target.id, node.value
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target, value = node.targets[0].id, node.value
        if target == name:
            try:
                return ast.literal_eval(value)
            except (ValueError, TypeError, SyntaxError) as exc:
                raise CatalogError(f"{name} must remain a literal assignment: {exc}") from exc
    raise CatalogError(f"literal assignment {name!r} not found")


def load_backend_sources(path: Path = DEFAULT_BACKEND) -> tuple[dict[str, list[dict]], dict[str, str]]:
    module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    funds = _assignment_value(module, "STATIC_FUNDS")
    etfs = _assignment_value(module, "STATIC_ETFS")
    try:
        c_to_a = _assignment_value(module, "_C_TO_A_HOLDINGS_MAP")
    except CatalogError:
        c_to_a = {}

    if not isinstance(funds, dict) or not isinstance(etfs, list) or not isinstance(c_to_a, dict):
        raise CatalogError("backend product literals have unexpected types")
    unknown = set(funds) - set(ALLOWED_CATEGORIES)
    if unknown:
        raise CatalogError(f"unexpected backend categories: {sorted(unknown)}")

    datasets = {category: list(rows) for category, rows in funds.items()}
    datasets["etfs"] = list(etfs)
    return datasets, {str(code): str(master) for code, master in c_to_a.items()}


def _extract_balanced_object(text: str, marker: str) -> str:
    marker_index = text.find(marker)
    if marker_index < 0:
        raise CatalogError(f"frontend marker {marker!r} not found")
    start = text.find("{", marker_index + len(marker))
    if start < 0:
        raise CatalogError(f"opening brace after {marker!r} not found")

    depth = 0
    quote = None
    escaped = False
    line_comment = False
    block_comment = False
    index = start
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""

        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and nxt == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and nxt == "*":
            block_comment = True
            index += 2
            continue
        if char in ('"', "'"):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
        index += 1
    raise CatalogError(f"object after {marker!r} is not balanced")


def _strip_js_comments(text: str) -> str:
    output: list[str] = []
    quote = None
    escaped = False
    line_comment = False
    block_comment = False
    index = 0
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
                output.append(char)
            index += 1
            continue
        if block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and nxt == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and nxt == "*":
            block_comment = True
            index += 2
            continue
        if char in ('"', "'"):
            quote = char
        output.append(char)
        index += 1
    return "".join(output)


def _js_literal_to_python(text: str) -> Any:
    literal = _strip_js_comments(text)
    literal = re.sub(r"([\{,]\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', literal)
    literal = re.sub(r"\bnull\b", "None", literal)
    literal = re.sub(r"\btrue\b", "True", literal)
    literal = re.sub(r"\bfalse\b", "False", literal)
    try:
        return ast.literal_eval(literal)
    except (ValueError, TypeError, SyntaxError) as exc:
        raise CatalogError(f"frontend FALLBACK is not a supported literal: {exc}") from exc


def load_frontend_fallback(path: Path = DEFAULT_FRONTEND) -> dict[str, list[dict]]:
    text = path.read_text(encoding="utf-8")
    fallback = _js_literal_to_python(_extract_balanced_object(text, "const FALLBACK"))
    if not isinstance(fallback, dict):
        raise CatalogError("frontend FALLBACK must be an object")
    unknown = set(fallback) - set(ALLOWED_CATEGORIES)
    if unknown:
        raise CatalogError(f"unexpected frontend categories: {sorted(unknown)}")
    return {category: list(rows) for category, rows in fallback.items()}


def _flatten(datasets: dict[str, list[dict]], source_name: str) -> dict[str, dict]:
    flattened: dict[str, dict] = {}
    for category in ALLOWED_CATEGORIES:
        for row in datasets.get(category, []):
            if not isinstance(row, dict):
                raise CatalogError(f"{source_name} {category} contains a non-object row")
            code = row.get("code")
            if not isinstance(code, str):
                raise CatalogError(f"{source_name} product code must be a string: {code!r}")
            if not CODE_RE.fullmatch(code):
                raise CatalogError(f"{source_name} product code must contain six digits: {code!r}")
            if code in flattened:
                flattened[code]["categories"].add(category)
                flattened[code]["record"].update(row)
            else:
                flattened[code] = {
                    "record": dict(row),
                    "categories": {category},
                }
    return flattened


def source_diff(backend: dict[str, dict], frontend: dict[str, dict]) -> dict[str, Any]:
    backend_codes = set(backend)
    frontend_codes = set(frontend)
    shared = sorted(backend_codes & frontend_codes)
    conflict_products = 0
    conflict_fields = 0
    conflicts_by_field: Counter[str] = Counter()
    for code in shared:
        backend_row = backend[code]["record"]
        frontend_row = frontend[code]["record"]
        row_conflicts = 0
        for field in DIFF_FIELDS:
            if backend_row.get(field) != frontend_row.get(field):
                conflict_fields += 1
                row_conflicts += 1
                conflicts_by_field[field] += 1
        if row_conflicts:
            conflict_products += 1
    return {
        "backend_products": len(backend_codes),
        "frontend_products": len(frontend_codes),
        "union_products": len(backend_codes | frontend_codes),
        "shared_products": len(shared),
        "backend_only_count": len(backend_codes - frontend_codes),
        "backend_only_codes": sorted(backend_codes - frontend_codes),
        "frontend_only_count": len(frontend_codes - backend_codes),
        "frontend_only_codes": sorted(frontend_codes - backend_codes),
        "conflicting_products": conflict_products,
        "conflicting_fields": conflict_fields,
        "conflicts_by_field": dict(sorted(conflicts_by_field.items())),
    }


def _infer_share_class(code: str, row: dict, c_to_a: dict[str, str], a_to_c: dict[str, set[str]]) -> str:
    if code in c_to_a:
        return "C"
    if row.get("code_c") or code in a_to_c:
        return "A"
    name = str(row.get("name") or "").strip()
    if re.search(r"(?:人民币|发起式|\))?C$", name):
        return "C"
    if re.search(r"(?:人民币|发起式|\))?A$", name):
        return "A"
    return "unspecified"


def _finite_or_none(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def build_catalog(
    backend_path: Path = DEFAULT_BACKEND,
    frontend_path: Path = DEFAULT_FRONTEND,
    metadata_as_of: str | None = None,
) -> dict[str, Any]:
    backend_datasets, c_to_a = load_backend_sources(backend_path)
    frontend_datasets = load_frontend_fallback(frontend_path)
    backend = _flatten(backend_datasets, "backend")
    frontend = _flatten(frontend_datasets, "frontend")
    diff = source_diff(backend, frontend)

    a_to_c: dict[str, set[str]] = defaultdict(set)
    for child, master in c_to_a.items():
        a_to_c[master].add(child)

    products = []
    for code in sorted(set(backend) | set(frontend)):
        backend_item = backend.get(code)
        frontend_item = frontend.get(code)
        # Missing backend keys fall back to frontend; present backend keys win,
        # including an intentional null.
        canonical: dict[str, Any] = {}
        categories: set[str] = set()
        sources: list[str] = []
        if frontend_item:
            canonical.update(frontend_item["record"])
            categories.update(frontend_item["categories"])
            sources.append("src/App.jsx:FALLBACK")
        if backend_item:
            canonical.update(backend_item["record"])
            categories.update(backend_item["categories"])
            backend_source = "api/index.py:STATIC_ETFS" if "etfs" in backend_item["categories"] else "api/index.py:STATIC_FUNDS"
            sources.insert(0, backend_source)

        related_codes: set[str] = set()
        if isinstance(canonical.get("code_c"), str):
            related_codes.add(canonical["code_c"])
        if code in c_to_a:
            related_codes.add(c_to_a[code])
        related_codes.update(a_to_c.get(code, set()))
        related_codes.discard(code)

        category_list = [category for category in ALLOWED_CATEGORIES if category in categories]
        is_etf = "etfs" in categories
        share_class = _infer_share_class(code, canonical, c_to_a, a_to_c)
        # A C-class row may exist without its A-class product in either source
        # (currently 016823). Keep that relationship explicitly unresolved
        # instead of inventing a master code.
        master_code = c_to_a.get(code, None if share_class == "C" else code)
        if backend_item:
            product_as_of = BACKEND_ETFS_AS_OF if is_etf else BACKEND_FUNDS_AS_OF
        else:
            product_as_of = None

        products.append({
            "code": code,
            "name": str(canonical.get("name") or code),
            "product_type": "etf" if is_etf else "fund",
            "categories": category_list,
            "share_class": share_class,
            "master_code": master_code,
            "related_share_codes": sorted(related_codes),
            "tracking_index": canonical.get("tracking_index") if isinstance(canonical.get("tracking_index"), str) else None,
            "static_snapshot": {
                "annual_return_2025": _finite_or_none(canonical.get("ytd_return")),
                "scale": _finite_or_none(canonical.get("scale")),
                "fee": _finite_or_none(canonical.get("fee_rate")),
                "track_error": _finite_or_none(canonical.get("track_error")),
                "daily_limit": canonical.get("daily_limit") if isinstance(canonical.get("daily_limit"), str) else None,
                "subscription_status": canonical.get("buy_status") if isinstance(canonical.get("buy_status"), str) else None,
                "premium": _finite_or_none(canonical.get("premium")),
                "volume": _finite_or_none(canonical.get("volume")),
                "change_pct": _finite_or_none(canonical.get("change_pct")),
                "market_price": _finite_or_none(canonical.get("market_price")),
                "nav": _finite_or_none(canonical.get("nav")),
            },
            "metadata_as_of": product_as_of,
            "source": sources,
        })

    catalog = {
        "$schema": "./products.schema.json",
        "schema_version": 1,
        "catalog_version": "1.0.0",
        "metadata_as_of": metadata_as_of or date.today().isoformat(),
        "source": ["api/index.py", "src/App.jsx"],
        "merge_policy": "backend_preferred_frontend_union",
        "metadata": {
            "source_diff": diff,
            "units": {
                "annual_return_2025": "percent",
                "scale": "CNY_100M",
                "fee": "annual_percent",
                "track_error": "annual_percent",
                "premium": "percent",
                "volume": "CNY_100M",
                "change_pct": "percent",
            },
        },
        "products": products,
    }
    validate_catalog(catalog)
    return catalog


def _reject_non_json_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant {value!r}")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=_reject_non_json_constant,
        )
    except FileNotFoundError as exc:
        raise CatalogError(f"JSON file not found: {path}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise CatalogError(f"invalid JSON in {path}: {exc}") from exc


def _json_path(parts: Iterable[Any]) -> str:
    path = "$"
    for part in parts:
        path += f"[{part}]" if isinstance(part, int) else f".{part}"
    return path


def validate_catalog_schema(
    catalog: dict[str, Any],
    schema_path: Path = DEFAULT_SCHEMA,
) -> None:
    """Validate the catalog against the checked-in Draft 2020-12 contract.

    ``FormatChecker`` is deliberately enabled: without it, a schema ``date``
    format is only documentation and strings such as ``2026-99-99`` pass.
    """

    if Draft202012Validator is None or FormatChecker is None:
        raise CatalogError(
            "jsonschema with Draft 2020-12 support is required; "
            "install the repository Python requirements"
        )

    schema = _read_json(schema_path)
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise CatalogError(f"invalid catalog schema {schema_path}: {exc.message}") from exc

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(
        validator.iter_errors(catalog),
        key=lambda error: tuple(str(part) for part in error.absolute_path),
    )
    if errors:
        details = [
            f"{_json_path(error.absolute_path)}: {error.message}"
            for error in errors[:25]
        ]
        if len(errors) > len(details):
            details.append(f"... and {len(errors) - len(details)} more schema errors")
        raise CatalogError("catalog JSON Schema validation failed:\n- " + "\n- ".join(details))


def validate_catalog(catalog: dict[str, Any]) -> dict[str, int]:
    validate_catalog_schema(catalog)
    errors: list[str] = []
    if not isinstance(catalog, dict):
        raise CatalogError("catalog root must be an object")
    if catalog.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if not DATE_RE.fullmatch(str(catalog.get("metadata_as_of") or "")):
        errors.append("metadata_as_of must be YYYY-MM-DD")
    products = catalog.get("products")
    if not isinstance(products, list):
        raise CatalogError("products must be an array")

    codes: set[str] = set()
    category_counts: Counter[str] = Counter()
    relation_owners: dict[str, str] = {}
    product_map: dict[str, dict] = {}
    for index, product in enumerate(products):
        prefix = f"products[{index}]"
        if not isinstance(product, dict):
            errors.append(f"{prefix} must be an object")
            continue
        code = product.get("code")
        if not isinstance(code, str) or not CODE_RE.fullmatch(code):
            errors.append(f"{prefix}.code must be a six-digit string")
            continue
        if code in codes:
            errors.append(f"duplicate product code {code}")
        codes.add(code)
        product_map[code] = product

        categories = product.get("categories")
        if not isinstance(categories, list) or not categories:
            errors.append(f"{code} must have at least one category")
            categories = []
        if len(categories) != len(set(categories)):
            errors.append(f"{code} has duplicate categories")
        for category in categories:
            if category not in ALLOWED_CATEGORIES:
                errors.append(f"{code} has invalid category {category!r}")
            else:
                category_counts[category] += 1

        expected_type = "etf" if "etfs" in categories else "fund"
        if product.get("product_type") != expected_type:
            errors.append(f"{code} product_type/category mismatch")
        if product.get("share_class") not in ("A", "C", "unspecified"):
            errors.append(f"{code} has invalid share_class")

        master = product.get("master_code")
        if master is not None and (not isinstance(master, str) or not CODE_RE.fullmatch(master)):
            errors.append(f"{code} master_code must be a six-digit string or null")
        if master is None and product.get("share_class") != "C":
            errors.append(f"only an unresolved C share may have a null master_code ({code})")
        relations = product.get("related_share_codes")
        if not isinstance(relations, list) or len(relations) != len(set(relations)):
            errors.append(f"{code} related_share_codes must be a unique array")
            relations = []
        for relation in relations:
            if not isinstance(relation, str) or not CODE_RE.fullmatch(relation):
                errors.append(f"{code} has invalid related share code {relation!r}")
            elif relation == code:
                errors.append(f"{code} cannot reference itself as a related share")
            elif relation in relation_owners and relation_owners[relation] != code:
                # A master and its C child legitimately reference one another;
                # otherwise the same unlisted C code should not belong to two A products.
                previous = relation_owners[relation]
                if previous not in relations:
                    errors.append(f"related share {relation} is owned by both {previous} and {code}")
            else:
                relation_owners[relation] = code

        snapshot = product.get("static_snapshot")
        if not isinstance(snapshot, dict):
            errors.append(f"{code} static_snapshot must be an object")
        else:
            missing_fields = set(SNAPSHOT_FIELDS) - set(snapshot)
            if missing_fields:
                errors.append(f"{code} snapshot missing {sorted(missing_fields)}")
            for field in ("annual_return_2025", "scale", "fee", "track_error", "premium", "volume", "change_pct", "market_price", "nav"):
                value = snapshot.get(field)
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)):
                    errors.append(f"{code} snapshot {field} must be finite or null")
        as_of = product.get("metadata_as_of")
        if as_of is not None and (not isinstance(as_of, str) or not DATE_RE.fullmatch(as_of)):
            errors.append(f"{code} metadata_as_of must be a date or null")
        sources = product.get("source")
        if not isinstance(sources, list) or not sources or not all(isinstance(item, str) and item for item in sources):
            errors.append(f"{code} source must be a non-empty string array")

    for code, product in product_map.items():
        master = product.get("master_code")
        if master is not None and master not in product_map:
            errors.append(f"{code} master_code {master} is absent from catalog")
        if product.get("share_class") == "C" and master == code:
            errors.append(f"C share {code} must reference an A/master product")
        for related in product.get("related_share_codes", []):
            if related in product_map:
                other = product_map[related]
                if code not in other.get("related_share_codes", []):
                    errors.append(f"internal A/C relation {code}<->{related} is not reciprocal")

    if errors:
        raise CatalogError("catalog validation failed:\n- " + "\n- ".join(errors))
    return {
        "products": len(products),
        "categories": len(category_counts),
        "relations": sum(len(product.get("related_share_codes", [])) for product in products),
    }


def load_catalog(path: Path = DEFAULT_CATALOG) -> dict[str, Any]:
    value = _read_json(path)
    if not isinstance(value, dict):
        raise CatalogError("catalog root must be an object")
    validate_catalog(value)
    return value


def _json_text(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=False,
            allow_nan=False,
        ) + "\n"
    except (TypeError, ValueError) as exc:
        raise CatalogError(f"catalog is not strict JSON: {exc}") from exc


def write_catalog_atomic(
    path: Path,
    catalog: dict[str, Any],
    *,
    replace_existing: bool = True,
) -> None:
    """Validate and durably publish a catalog without exposing a partial file.

    Refresh jobs use the default atomic replacement.  Bootstrap passes
    ``replace_existing=False`` so even a file created after its initial
    existence check cannot be overwritten (an exclusive hard link closes that
    check/write race).
    """

    validate_catalog(catalog)
    text = _json_text(catalog)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)

        mode = (path.stat().st_mode & 0o777) if path.exists() else 0o644
        os.chmod(temp_path, mode)
        if replace_existing:
            temp_path.replace(path)
            temp_path = None
        else:
            try:
                os.link(temp_path, path)
            except FileExistsError as exc:
                raise CatalogError(f"refusing to overwrite existing catalog {path}") from exc
            temp_path.unlink()
            temp_path = None

        # Best-effort directory fsync makes the rename durable on POSIX.  It is
        # intentionally non-fatal on filesystems that do not support it.
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def _summary(catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        "catalog": validate_catalog(catalog),
        "source_diff": catalog["metadata"]["source_diff"],
    }


def identity_projection(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Fields that legacy source literals are still allowed to verify."""
    return {
        product["code"]: {
            "product_type": product["product_type"],
            "categories": product["categories"],
            "share_class": product["share_class"],
            "master_code": product["master_code"],
            "related_share_codes": product["related_share_codes"],
        }
        for product in catalog["products"]
    }


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--write",
        action="store_true",
        help="bootstrap a new catalog; refuses to replace an existing catalog",
    )
    mode.add_argument("--validate-only", action="store_true", help="validate the existing catalog without rebuilding")
    parser.add_argument("--backend", type=Path, default=DEFAULT_BACKEND)
    parser.add_argument("--frontend", type=Path, default=DEFAULT_FRONTEND)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--as-of", help="catalog metadata date (YYYY-MM-DD)")
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        if args.validate_only:
            current = load_catalog(args.catalog)
            print(json.dumps(_summary(current), ensure_ascii=False, indent=2))
            return 0

        current = None
        if args.catalog.exists():
            current = load_catalog(args.catalog)
        if args.write and current is not None:
            raise CatalogError(
                f"refusing to overwrite existing catalog {args.catalog}; "
                "use refresh_catalog_metadata.py for metadata updates"
            )
        as_of = args.as_of or (current and current.get("metadata_as_of")) or date.today().isoformat()
        if not DATE_RE.fullmatch(str(as_of)):
            raise CatalogError("--as-of must use YYYY-MM-DD")
        generated = build_catalog(args.backend, args.frontend, metadata_as_of=str(as_of))

        if args.write:
            write_catalog_atomic(args.catalog, generated, replace_existing=False)
            print(json.dumps(_summary(generated), ensure_ascii=False, indent=2))
            return 0

        if current is None:
            raise CatalogError(f"catalog not found: {args.catalog}; run with --write once")
        if identity_projection(current) != identity_projection(generated):
            raise CatalogError("product identity/category drift detected; review catalog membership")
        print(json.dumps(_summary(current), ensure_ascii=False, indent=2))
        return 0
    except (CatalogError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
