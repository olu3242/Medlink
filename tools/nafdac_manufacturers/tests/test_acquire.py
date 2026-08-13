import csv
from datetime import datetime, timezone
from pathlib import Path

from tools.nafdac_manufacturers.acquire import CSV_COLUMNS, write_snapshot
from tools.nafdac_manufacturers.models import GreenbookManufacturer


def test_snapshot_matches_wave1_manufacturer_adapter_contract(tmp_path: Path) -> None:
    record = GreenbookManufacturer("370", "GlaxoSmithKline LLC.", "https://greenbook.nafdac.gov.ng/manufacturer/products/370", 1, 2, 1, 1, "https://greenbook.nafdac.gov.ng/manufacturers", datetime(2026, 8, 13, tzinfo=timezone.utc))
    destination = tmp_path / "manufacturers.csv"
    write_snapshot((record,), destination)
    with destination.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        assert tuple(reader.fieldnames or ()) == CSV_COLUMNS
        assert list(reader)[0]["manufacturer_id"] == "370"
