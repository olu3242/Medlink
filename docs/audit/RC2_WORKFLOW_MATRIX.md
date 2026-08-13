# RC2 Workflow Matrix

Two established namespaces exist and must not be renumbered:

- `WF-001` through `WF-015`: stable platform workflow identities from ADR-0003.
- `ML-WF-*`: MVP implementation definitions that refine parts of the stable
  library. They do not replace or renumber the `WF-*` catalogue.

## Stable platform workflows

| ID | Canonical meaning | Executable evidence | Status | Primary gap |
| --- | --- | --- | --- | --- |
| WF-001 | Patient Registration | auth/profile schema and fallback web profile | PARTIAL | No WhatsApp onboarding/account link |
| WF-002 | Authentication | Supabase auth callback and API membership resolution | PARTIAL | Four-persona and WhatsApp OTP evidence absent |
| WF-003 | Prescription Upload | `ML-WF-001`, intake service/RPC/UI | BLOCKED | Scanner and live storage/RLS evidence |
| WF-004 | Prescription Parsing | `ML-WF-002` and `ML-WF-003`, fenced worker | BLOCKED | OCR/parser providers and live worker evidence |
| WF-005 | Medicine Search | catalogue search RPC/APIs/UI | PARTIAL | No nearby FEFO inventory join |
| WF-006 | Medication Access Request | schema, routes and transition audit | PARTIAL | Direct data application and incomplete orchestration |
| WF-007 | Clinical Review | `ML-WF-004` and `ML-WF-005`, pharmacist APIs/UI, canonical resolution, clarification and atomic RPC | BLOCKED | Live license/RLS/atomic-decision evidence |
| WF-008 | Inventory Discovery | `ML-WF-008`, inventory domain/repository, atomic RPCs, pharmacy UI/API, ledger and FEFO projection | BLOCKED | Live migration, RLS, idempotency and concurrency evidence; patient nearby matching is Batch 3 |
| WF-009 | Reservation | `reserve_inventory`, service and UI scaffold | PARTIAL | UI/API contract mismatch; no full persistence adapter |
| WF-010 | Pickup | fulfilment coordinator and transition table | PARTIAL | No governed APIs/UI/lock consumption notification path |
| WF-011 | Delivery | legacy identifiers only | DEFERRED | Delivery fleets are outside current MVP scope |
| WF-012 | Medication Reminder | adherence/notification primitives | DEFERRED | Not ahead of unresolved P0/P1 Golden Path work |
| WF-013 | Consultation | review/handoff fragments | PARTIAL | No canonical consultation aggregate or workflow |
| WF-014 | Refill | no owned domain path | DEFERRED | Post-MVP admission required |
| WF-015 | Workflow Completion | generic workflow completion helper | PARTIAL | No Golden Path completion policy/evidence |

## MVP implementation workflows

| ID | Meaning | Owner | Status | Evidence / blocker |
| --- | --- | --- | --- | --- |
| ML-WF-001 | Prescription Upload | ML-CAP-006 | BLOCKED | Source-complete intake; scanner/storage/live RLS unavailable |
| ML-WF-002 | Prescription OCR | ML-CAP-006 | BLOCKED | ARC task and fenced worker; provider/live execution unavailable |
| ML-WF-003 | Prescription Parsing | ML-CAP-006 | BLOCKED | ARC task/provider contract; provider/live execution unavailable |
| ML-WF-004 | Clinical Validation | ML-CAP-006 | BLOCKED | Deterministic findings and evidence; live transaction unavailable |
| ML-WF-005 | Pharmacist Review | ML-CAP-007 | BLOCKED | Source-complete canonical resolution and clarification loop; live licensed-user/RLS proof unavailable |
| ML-WF-006 | Manual Prescription Intake | ML-CAP-006 | BLOCKED | Source-complete; live ownership/concurrency/RLS proof unavailable |
| ML-WF-007 | Canonical Medicine Governance | ML-CAP-005 | BLOCKED | Source-complete; live admin/idempotency/RLS proof unavailable |
| ML-WF-008 | Inventory Management & Availability | ML-CAP-008 | BLOCKED | Source-complete stock commands, ledger, UI/API and expiry recovery; live migration/RLS/concurrency proof unavailable |

`ML-WF-008` refines stable `WF-008` without renumbering it. The next authorized
definition is Batch 3 search/matching and reservation; it is not implemented by
the Batch 2 checkpoint.
