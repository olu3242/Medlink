from datetime import datetime, timezone
from pathlib import Path

import pytest

from tools.nafdac_manufacturers.parser import SourceContractError, parse_manufacturer_page, parse_product_page

FIXTURE = Path(__file__).parents[1] / "fixtures" / "manufacturers_page.html"


def test_manufacturer_contract_and_pagination() -> None:
    retrieved = datetime(2026, 8, 13, tzinfo=timezone.utc)
    page = parse_manufacturer_page(FIXTURE.read_text(encoding="utf-8"), "https://greenbook.nafdac.gov.ng/manufacturers", retrieved)
    assert page.current_page == 1
    assert page.next_url == "https://greenbook.nafdac.gov.ng/manufacturers?page=2"
    assert page.observed_pages == (1, 2)
    assert [(row.source_id, row.source_name, row.product_count, row.ingredient_count) for row in page.records] == [
        ("370", "Example & Sons, Ltd.", 2, 2),
        ("1407", "AbbVie S.r.l", 0, 0),
        ("999", "Élan Pharma (Nig.)", 1, 0),
    ]
    assert page.records[2].source_page == 1
    assert page.records[2].source_position == 3
    assert page.records[2].retrieved_at == retrieved


@pytest.mark.parametrize("html", ["<html></html>", "<a href='/manufacturer/products/1'><h5>Name</h5></a>"])
def test_schema_change_or_malformed_entry_fails_loudly(html: str) -> None:
    with pytest.raises(SourceContractError):
        parse_manufacturer_page(html, "https://greenbook.nafdac.gov.ng/manufacturers", datetime.now(timezone.utc))


def test_product_relationship_parser() -> None:
    html = "<a href='/products/details/9452'>#Devhexol 300 Injection</a><a href='/products/details/21'>Café product</a><a href='/manufacturer/products/1161'>More</a>"
    products = parse_product_page(html, "https://greenbook.nafdac.gov.ng/manufacturer/products/1161")
    assert [(item.product_id, item.product_name) for item in products] == [("9452", "#Devhexol 300 Injection"), ("21", "Café product")]
