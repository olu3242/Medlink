import re
from datetime import datetime
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlparse

from .models import GreenbookManufacturer, ManufacturerPage, ProductReference


class SourceContractError(ValueError):
    """The public Greenbook response no longer satisfies the certified contract."""


class _TreeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[dict[str, object]] = []
        self.nodes: list[dict[str, object]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node: dict[str, object] = {"tag": tag, "attrs": dict(attrs), "text": [], "children": []}
        if self.stack:
            self.stack[-1]["children"].append(node)  # type: ignore[union-attr]
        else:
            self.nodes.append(node)
        self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if self.stack:
            self.stack[-1]["text"].append(data)  # type: ignore[union-attr]


def _walk(nodes: list[dict[str, object]]):
    for node in nodes:
        yield node
        yield from _walk(node["children"])  # type: ignore[arg-type]


def _text(node: dict[str, object]) -> str:
    values = list(node["text"])  # type: ignore[arg-type]
    for child in node["children"]:  # type: ignore[union-attr]
        values.append(_text(child))
    return " ".join(" ".join(values).split())


def _page_number(url: str, default: int = 1) -> int:
    raw = parse_qs(urlparse(url).query).get("page", [str(default)])[0]
    try:
        page = int(raw)
    except ValueError as error:
        raise SourceContractError(f"invalid page number: {raw}") from error
    if page < 1:
        raise SourceContractError(f"invalid page number: {page}")
    return page


def parse_manufacturer_page(html: str, source_url: str, retrieved_at: datetime) -> ManufacturerPage:
    parser = _TreeParser()
    parser.feed(html)
    current_page = _page_number(source_url)
    records: list[GreenbookManufacturer] = []
    pages: set[int] = {current_page}
    next_url: str | None = None
    for node in _walk(parser.nodes):
        attrs = node["attrs"]  # type: ignore[assignment]
        if node["tag"] != "a" or not isinstance(attrs, dict):
            continue
        href = str(attrs.get("href") or "")
        match = re.fullmatch(r"https?://[^/]+/manufacturer/products/(\d+)/?", urljoin(source_url, href))
        if match:
            headings = [candidate for candidate in _walk(node["children"]) if candidate["tag"] == "h5"]  # type: ignore[arg-type]
            name = _text(headings[0]) if headings else ""
            count_match = re.search(r"(\d+)\s+Products?\s*,\s*(\d+)\s+Ingredients?", _text(node), re.IGNORECASE)
            if not name or not count_match:
                raise SourceContractError(f"malformed manufacturer entry: {href}")
            records.append(GreenbookManufacturer(match.group(1), name, urljoin(source_url, href), int(count_match.group(1)), int(count_match.group(2)), current_page, len(records) + 1, source_url, retrieved_at))
        if "/manufacturers" in href and "page=" in href:
            absolute = urljoin(source_url, href)
            pages.add(_page_number(absolute))
            if attrs.get("rel") == "next":
                next_url = absolute
    if not records:
        raise SourceContractError("SOURCE_SCHEMA_MISMATCH: no manufacturer entries")
    ids = [record.source_id for record in records]
    if len(ids) != len(set(ids)):
        raise SourceContractError("duplicate manufacturer source ID on page")
    return ManufacturerPage(tuple(records), current_page, next_url, tuple(sorted(pages)))


def parse_product_page(html: str, source_url: str) -> tuple[ProductReference, ...]:
    parser = _TreeParser()
    parser.feed(html)
    products: dict[str, ProductReference] = {}
    for node in _walk(parser.nodes):
        attrs = node["attrs"]  # type: ignore[assignment]
        if node["tag"] != "a" or not isinstance(attrs, dict):
            continue
        href = urljoin(source_url, str(attrs.get("href") or ""))
        match = re.search(r"/products/details/(\d+)/?$", href)
        if match:
            headings = [candidate for candidate in _walk(node["children"]) if candidate["tag"] == "h5"]  # type: ignore[arg-type]
            spans = [_text(candidate) for candidate in _walk(node["children"]) if candidate["tag"] == "span"]  # type: ignore[arg-type]
            name = _text(headings[0]) if headings else ""
            if name:
                nrn_value = next((value.removeprefix("NRN:").strip() for value in spans if value.upper().startswith("NRN:")), None)
                composition = next((value for value in spans if value and not value.upper().startswith("NRN:") and value not in name), None)
                products[match.group(1)] = ProductReference(match.group(1), name, composition, nrn_value, href)
    return tuple(products.values())
