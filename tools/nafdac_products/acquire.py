import csv
import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from tools.nafdac_manufacturers.client import GreenbookClient
from tools.nafdac_manufacturers.parser import SourceContractError

LISTING_URL = "https://greenbook.nafdac.gov.ng/"
PRODUCT_COLUMNS = ("product_id","ingredient_id","manufacturer_id","product_name","form_id","strength","NAFDAC","product_category_id","marketing_category_id","applicant_id","approval_date","expiry_date","route_id","smpc","country_id","product_description","pack_size","biosimilar","atc","created_at","updated_at","deleted_at","status","composition","ingredient","form","applicant","route","product_category","category_name","ingredient_name","synonym","form_name","applicant_name","route_name","DT_RowIndex")

def _flat(row: dict[str, object]) -> dict[str, object]:
    result = dict(row)
    for key, output, child in (("ingredient","ingredient_name","ingredient_name"),("form","form_name","name"),("applicant","applicant_name","name"),("route","route_name","name"),("product_category","category_name","name")):
        value = row.get(key)
        if isinstance(value, dict):
            result[output] = value.get(child) or ""
        elif value is None:
            result[key] = ""
    return {column: "" if result.get(column) is None else result.get(column, "") for column in PRODUCT_COLUMNS}

def _atomic_json(path: Path, value: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)

def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def acquire_snapshot(output: Path, adapter_commit: str, parser_sha256: str, *, client: GreenbookClient | None = None, page_size: int = 100) -> dict[str, object]:
    client = client or GreenbookClient()
    output.mkdir(parents=True, exist_ok=True)
    checkpoints = output / "listing-checkpoints"; checkpoints.mkdir(exist_ok=True)
    started = datetime.now(timezone.utc); network_started = time.perf_counter()
    total: int | None = None; start = 0; requests = 0
    while total is None or start < total:
        checkpoint = checkpoints / f"{start:08d}.json"
        if checkpoint.exists():
            payload = json.loads(checkpoint.read_text(encoding="utf-8"))
        else:
            query = urlencode({"draw": start // page_size + 1, "start": start, "length": page_size, "search[value]": "", "search[regex]": "false", "search_ingredient": ""})
            _, raw, _ = client.get_json(f"{LISTING_URL}?{query}"); requests += 1
            if not isinstance(raw, dict): raise SourceContractError("SOURCE_SCHEMA_MISMATCH: listing root")
            payload = raw; _atomic_json(checkpoint, payload)
        if not isinstance(payload.get("data"), list) or not isinstance(payload.get("recordsTotal"), int):
            raise SourceContractError("SOURCE_SCHEMA_MISMATCH: DataTables envelope")
        observed = int(payload["recordsTotal"])
        if total is None: total = observed
        elif total != observed: raise SourceContractError("SOURCE_CHANGED_DURING_ACQUISITION")
        rows = payload["data"]
        if start < total and not rows: raise SourceContractError("PARTIAL_ACQUISITION: empty non-terminal page")
        start += len(rows)
        if start % (page_size * 10) == 0 or start >= total:
            print(f"products={min(start, total)}/{total} network_requests={requests}", flush=True)
    raw_rows: list[dict[str, object]] = []
    for path in sorted(checkpoints.glob("*.json")):
        raw_rows.extend(json.loads(path.read_text(encoding="utf-8"))["data"])
    rows = [_flat(row) for row in raw_rows[:total]]
    ids = [str(row["product_id"]) for row in rows]
    if len(rows) != total or len(ids) != len(set(ids)): raise SourceContractError("SNAPSHOT_IDENTITY_FAILURE")
    csv_path = output / "nafdac_greenbook_products.csv"; tmp = csv_path.with_suffix(".csv.tmp")
    with tmp.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=PRODUCT_COLUMNS, lineterminator="\n"); writer.writeheader(); writer.writerows(rows)
    tmp.replace(csv_path)
    metadata = {"source": LISTING_URL, "retrieved_at": datetime.now(timezone.utc).isoformat(), "records": len(rows), "unique_product_ids": len(set(ids)), "duplicate_ids": len(ids)-len(set(ids)), "invalid_ids": sum(not value.isdigit() for value in ids), "pages": len(list(checkpoints.glob('*.json'))), "network_requests": requests, "network_duration_seconds": time.perf_counter()-network_started, "adapter_commit": adapter_commit, "parser_sha256": parser_sha256, "python_version": platform.python_version(), "csv": {"path": str(csv_path), "sha256": _hash(csv_path)}}
    _atomic_json(output / "product-acquisition-metadata.json", metadata)
    return metadata
