# NAFDAC Greenbook manufacturer acquisition

Wave 1.5 acquires the public, server-rendered manufacturer directory without
changing MERDP canonical state. Python owns HTTP acquisition, source parsing,
validation, and external snapshot production. The existing `@medlink/merdp`
adapter owns governed ingestion and all later normalization, resolution,
provenance, certification, and publication.

## Certified source contract

- Listing: `GET https://greenbook.nafdac.gov.ng/manufacturers?page={n}` returns HTML.
- Identity: the decimal suffix of `/manufacturer/products/{manufacturer_id}` is
  the authoritative NAFDAC manufacturer source ID. It is not a canonical UUID.
- Listing fields: source ID, rendered manufacturer name, product count,
  ingredient count, detail URL, source page and position, source URL, retrieval
  timestamp.
- Pagination: follow the anchor marked `rel="next"`; terminate when it is absent.
  The client rejects URL loops, repeated record sets, non-sequential pages,
  duplicate source IDs, empty/schema-shifted pages, and traversal above its
  defensive maximum.
- Detail pages: `/manufacturer/products/{id}` list products with stable links
  `/products/details/{product_id}`. They expose product relationship evidence,
  but no manufacturer address or country was observed.

Run tests with `python -m pytest`. A future governed acquisition writes an
external artifact with `python -m tools.nafdac_manufacturers <external.csv>`.
Raw source dumps must remain outside Git. The resulting CSV intentionally uses
the existing eight-column `GreenbookManufacturerAdapter` contract.
