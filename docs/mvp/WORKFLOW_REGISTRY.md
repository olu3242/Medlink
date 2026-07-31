# MedLink MVP Workflow Registry

Version: 1.0  
Authority: MVP Constitution and Master Implementation Specification

MVP workflow identifiers use the `ML-WF-*` namespace. Earlier platform
catalogue identifiers remain unchanged for compatibility; `ML-WF-001` refines
the legacy `WF-003` prescription-upload entry for the RC2 pilot.

| ID | Version | Capability | Terminal outcome | Status |
| --- | ---: | --- | --- | --- |
| ML-WF-001 Prescription Upload | 1 | ML-CAP-003 | Scanned private file, durable prescription, OCR queue entry, events and evidence | Implemented; runtime certification pending |
| ML-WF-002 Prescription OCR | 1 | ML-CAP-004 | Structured OCR result with confidence | Planned |
| ML-WF-003 Prescription Parsing | 1 | ML-CAP-005 | Structured medicine candidates | Planned |
| ML-WF-004 Clinical Validation | 1 | ML-CAP-006 | Warnings routed to human review | Planned |
| ML-WF-005 Pharmacist Review | 1 | ML-CAP-007 | Recorded pharmacist decision | Planned |

## ML-WF-001 state and recovery contract

`initialized -> validated -> stored -> queued_for_ocr -> completed`

- Authentication, tenant resolution, authorization, validation, correlation,
  rate controls, audit and telemetry are inherited from canonical `runApi`.
- File signature, MIME and 10 MB size policy are enforced before scanning.
- The external scanner fails closed; only a `clean` result may reach storage.
- Storage is private and tenant/patient scoped. The content hash and
  idempotency key determine a retry-safe object path.
- One database function atomically creates workflow metadata, prescription
  state, immutable file evidence, the queued extraction and versioned outbox
  events.
- Database failure compensates by removing the unreferenced object.
- Async OCR delivery uses the existing outbox retry/dead-letter runtime.
- No clinical decision occurs in this workflow.

## Certification boundary

Implementation evidence includes domain, ARC, migration-contract and build
tests. Certification remains pending until the migration runs in an isolated
RC2 Supabase project and an authenticated upload proves RLS, scanner, storage,
workflow metadata, outbox events and compensation end to end.
