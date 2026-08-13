import csv
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from .client import GreenbookClient
from .models import GreenbookManufacturer

LISTING_URL = "https://greenbook.nafdac.gov.ng/manufacturers"
CSV_COLUMNS = ("manufacturer_id", "manufacturer_name", "product_count", "ingredient_count", "detail_url", "source_page", "source_position", "retrieved_at")


def acquire_directory(client: GreenbookClient, start_url: str = LISTING_URL) -> tuple[GreenbookManufacturer, ...]:
    records: list[GreenbookManufacturer] = []
    seen: set[str] = set()
    for _, page in client.traverse(start_url):
        for record in page.records:
            if record.source_id in seen:
                raise ValueError(f"duplicate manufacturer source ID across pages: {record.source_id}")
            seen.add(record.source_id)
            records.append(record)
    if not records:
        raise ValueError("SOURCE_SCHEMA_MISMATCH: empty manufacturer directory")
    return tuple(records)


def _rows(records: tuple[GreenbookManufacturer, ...]):
    for record in records:
        yield {"manufacturer_id": record.source_id, "manufacturer_name": record.source_name, "product_count": record.product_count, "ingredient_count": record.ingredient_count, "detail_url": record.detail_url, "source_page": record.source_page, "source_position": record.source_position, "retrieved_at": record.retrieved_at.isoformat()}


def write_snapshot(records: tuple[GreenbookManufacturer, ...], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", newline="", dir=destination.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        if destination.suffix.lower() == ".csv":
            writer = csv.DictWriter(temporary, fieldnames=CSV_COLUMNS)
            writer.writeheader()
            writer.writerows(_rows(records))
        elif destination.suffix.lower() == ".json":
            json.dump(list(_rows(records)), temporary, ensure_ascii=False, indent=2)
            temporary.write("\n")
        else:
            temporary_path.unlink(missing_ok=True)
            raise ValueError("snapshot destination must end in .csv or .json")
    os.replace(temporary_path, destination)
