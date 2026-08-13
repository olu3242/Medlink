import csv
import hashlib
import json
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError

from .acquire import LISTING_URL, acquire_directory, write_snapshot
from .client import GreenbookClient
from .models import GreenbookManufacturer
from .parser import SourceContractError, parse_product_page

TERMINAL = {"SUCCESS", "EMPTY_VALID", "NOT_FOUND", "CLIENT_ERROR", "SCHEMA_DRIFT"}


def _atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def acquire_detail(client: GreenbookClient, manufacturer: GreenbookManufacturer) -> dict[str, object]:
    started = time.perf_counter()
    retrieved_at = datetime.now(timezone.utc).isoformat()
    try:
        status, html, final_url = client.get_text(manufacturer.detail_url)
        products = parse_product_page(html, final_url)
        classification = "SUCCESS" if products else "EMPTY_VALID" if manufacturer.product_count == 0 else "SCHEMA_DRIFT"
        return {"manufacturer_source_id": manufacturer.source_id, "manufacturer_source_name": manufacturer.source_name, "classification": classification, "http_status": status, "detail_source_url": final_url, "retrieved_at": retrieved_at, "duration_seconds": time.perf_counter() - started, "products": [asdict(product) for product in products]}
    except RuntimeError as error:
        cause = error.__cause__
        if isinstance(cause, HTTPError):
            classification = "NOT_FOUND" if cause.code == 404 else "SERVER_ERROR" if cause.code >= 500 else "CLIENT_ERROR"
            status: int | None = cause.code
        elif isinstance(cause, (TimeoutError, URLError)):
            classification, status = "TIMEOUT", None
        else:
            classification, status = "PARSE_FAILURE", None
        return {"manufacturer_source_id": manufacturer.source_id, "manufacturer_source_name": manufacturer.source_name, "classification": classification, "http_status": status, "detail_source_url": manufacturer.detail_url, "retrieved_at": retrieved_at, "duration_seconds": time.perf_counter() - started, "error": str(error), "products": []}
    except SourceContractError as error:
        return {"manufacturer_source_id": manufacturer.source_id, "manufacturer_source_name": manufacturer.source_name, "classification": "SCHEMA_DRIFT", "http_status": 200, "detail_source_url": manufacturer.detail_url, "retrieved_at": retrieved_at, "duration_seconds": time.perf_counter() - started, "error": str(error), "products": []}


def run_bulk(output: Path, adapter_commit: str, parser_version: str, client: GreenbookClient | None = None) -> dict[str, object]:
    client = client or GreenbookClient()
    output.mkdir(parents=True, exist_ok=True)
    checkpoints = output / "detail-checkpoints"
    checkpoints.mkdir(exist_ok=True)
    started_at = datetime.now(timezone.utc)
    network_started = time.perf_counter()
    manufacturers = acquire_directory(client)
    directory_csv = output / "nafdac_greenbook_manufacturers.csv"
    write_snapshot(manufacturers, directory_csv)
    resumed = 0
    for position, manufacturer in enumerate(manufacturers, 1):
        checkpoint = checkpoints / f"{manufacturer.source_id}.json"
        if checkpoint.exists():
            prior = json.loads(checkpoint.read_text(encoding="utf-8"))
            if prior.get("classification") in TERMINAL:
                resumed += 1
                continue
        _atomic_json(checkpoint, acquire_detail(client, manufacturer))
        if position % 50 == 0:
            print(f"details={position}/{len(manufacturers)} resumed={resumed}", flush=True)
    evidence = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(checkpoints.glob("*.json"), key=lambda value: int(value.stem)) if path.stem in {record.source_id for record in manufacturers}]
    relationship_csv = output / "nafdac_greenbook_manufacturer_products.csv"
    with relationship_csv.open("w", encoding="utf-8", newline="") as target:
        columns = ("manufacturer_source_id", "manufacturer_source_name", "product_id", "product_name", "nrn", "composition", "detail_source_url", "retrieved_at")
        writer = csv.DictWriter(target, fieldnames=columns); writer.writeheader()
        for item in evidence:
            for product in item["products"]:
                writer.writerow({"manufacturer_source_id": item["manufacturer_source_id"], "manufacturer_source_name": item["manufacturer_source_name"], "product_id": product["product_id"], "product_name": product["product_name"], "nrn": product["nrn"] or "", "composition": product["composition"] or "", "detail_source_url": item["detail_source_url"], "retrieved_at": item["retrieved_at"]})
    classifications: dict[str, int] = {}
    for item in evidence:
        key = str(item["classification"]); classifications[key] = classifications.get(key, 0) + 1
    metadata = {"source": LISTING_URL, "started_at": started_at.isoformat(), "completed_at": datetime.now(timezone.utc).isoformat(), "adapter_commit": adapter_commit, "parser_version": parser_version, "pages": max(record.source_page for record in manufacturers), "records": len(manufacturers), "unique_source_ids": len({record.source_id for record in manufacturers}), "resumed_details": resumed, "detail_classifications": classifications, "relationships": sum(len(item["products"]) for item in evidence), "network_duration_seconds": time.perf_counter() - network_started, "artifacts": {"directory_csv": {"path": str(directory_csv), "sha256": _sha256(directory_csv)}, "relationships_csv": {"path": str(relationship_csv), "sha256": _sha256(relationship_csv)}}}
    _atomic_json(output / "acquisition-metadata.json", metadata)
    return metadata
