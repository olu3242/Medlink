# NAFDAC Greenbook MERDP Wave 1

The Greenbook adapters in `@medlink/merdp` accept artifact paths; regulatory
CSV files remain outside Git. An import first verifies SHA-256 and schema, then
creates immutable source records. Normalization never changes raw payloads.

Product `product_id` and manufacturer `manufacturer_id` are source identities.
NAFDAC/NRN is a separate regulatory identifier. Canonical medicines retain the
existing internal UUID identity. Manufacturer source records may map to the
existing organization model, but equal names never authorize an automatic merge.

Findings are INFO, WARNING, QUARANTINE, or REJECT. Unknown categories, unsafe NRN
collisions, unresolved relationships, and ambiguous mappings enter review.
Certification and publication are separate from ingestion. Runtime consumers
must use `merdp_publications`, never ETL source or staging tables.

The real-source certification is:

```powershell
npx.cmd vitest run packages/merdp/src
```

It requires the immutable artifacts at their supplied paths under
`C:\CDEV\NAFDAC-Greenbook`. Fixture 9452/1161 proves broken manufacturer
references remain unresolved; manufacturer IDs 370 and 718 prove equal names
remain distinct source identities.
