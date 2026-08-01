# Medicine Catalog

The catalog captures generic and brand names, strength, dosage form, and manufacturer. Search normalizes input and performs deterministic catalog lookup before semantic or AI assistance. Duplicate and equivalency rules live in `@medlink/medicine`; query orchestration lives in `@medlink/search`. Catalog mutations require medicine-management permission and an audit event.
