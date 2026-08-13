from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class GreenbookManufacturer:
    source_id: str
    source_name: str
    detail_url: str
    product_count: int
    ingredient_count: int
    source_page: int
    source_position: int
    source_url: str
    retrieved_at: datetime


@dataclass(frozen=True)
class ManufacturerPage:
    records: tuple[GreenbookManufacturer, ...]
    current_page: int
    next_url: str | None
    observed_pages: tuple[int, ...]


@dataclass(frozen=True)
class ProductReference:
    product_id: str
    product_name: str
    composition: str | None
    nrn: str | None
    detail_url: str
