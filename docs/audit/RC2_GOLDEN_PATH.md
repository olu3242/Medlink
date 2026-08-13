# RC2 Prescription-to-Fulfilment Golden Path

This is the primary RC2 product trace. It preserves established workflow IDs;
`ML-WF-*` definitions refine, but do not renumber, `WF-*` identities.

| Stage | Engine / workflow | Owning execution identity | API / UI | Persistence / events | Test evidence | Current result |
| --- | --- | --- | --- | --- | --- | --- |
| Patient identity | ML-CAP-001 / WF-001, WF-002 | deterministic API runtime | web sign-in and membership-backed APIs; no WhatsApp link | auth users, memberships, patient profile; runtime evidence | identity/authorization/static RLS tests | PARTIAL |
| Prescription upload/manual entry | ML-CAP-006 / WF-003, ML-WF-001, ML-WF-006 | file-scan ARC task for uploads | patient `/prescriptions/new`; `POST /api/v1/prescriptions` | prescriptions, files/items/extractions/workflows/outbox/audit | intake, management, migration tests | BLOCKED by scanner/live storage |
| OCR and parse | ML-CAP-006 / WF-004, ML-WF-002, ML-WF-003 | ARC OCR/parser tasks (`ML-ENG-013` usage) | internal clinical worker | OCR result, extraction/items, fenced workflow/outbox evidence | worker, provider-contract, retry/fence tests | BLOCKED by providers/live worker |
| Pharmacist review | ML-CAP-007 / WF-007, ML-WF-004, ML-WF-005 | verified human pharmacist; ARC has no decision authority | pharmacist queue/detail/decision APIs and UI; patient clarification response | validations/findings/evidence/resolved items/clarifications/pharmacist profile, atomic decision events/audit | clinical review, migration and integrated acceptance tests | BLOCKED by live authorization/RLS |
| Medicine resolution | ML-CAP-005/007 / WF-005, ML-WF-007 | catalogue application; authenticated pharmacist confirms/corrects | patient/admin catalogue plus pharmacist resolution/search UI | canonical medicines, append-only reviewed items, catalogue/resolution events | domain/migration/contract/acceptance tests | BLOCKED by live admin/pharmacist RLS |
| Inventory discovery | ML-CAP-008 / WF-008, ML-WF-008 | inventory application; no AI | pharmacy inventory list/create/detail/stock/ledger UI and API; pharmacist read-only availability | inventory batches, immutable transactions, locks, atomic RPCs, FEFO projection, audit/outbox | inventory domain/migration/expiry/API/acceptance tests | BLOCKED by live migration/concurrency/RLS |
| Alternative review | ML-CAP-005/007 / WF-007 | human pharmacist | catalogue alternatives API and review UI | equivalences requiring pharmacist review | catalogue safety tests | PARTIAL - not integrated into access request |
| Pharmacy selection | ML-CAP-003/009 / WF-005, WF-008 | deterministic discovery service | patient search page | pharmacy coordinates/hours plus inventory | one discovery unit test | PARTIAL - no API projection matching UI |
| Reservation | ML-CAP-010 / WF-009 | reservation/inventory commands | patient reserve UI and reservation API | atomic reservation and inventory lock; reservation event contracts | unit, migration and fulfilment tests | PARTIAL - UI/API mismatch |
| Pharmacy confirmation | ML-CAP-010 / WF-009 | pharmacy user | legacy reservation page; backing routes absent | reservation state and fulfilment transitions | coordinator unit tests | MISSING E2E |
| Pickup fulfilment | ML-CAP-010 / WF-010 | pharmacy user | no governed pickup API/UI | fulfilment transition table; ready/collected event contracts | coordinator unit tests | PARTIAL |
| Completion/history | WF-015 | workflow/runtime | patient prescription/MAR pages | workflow completion, audit/outbox/runtime evidence | generic workflow tests only | PARTIAL |
| WhatsApp channel | ML-CAP-011 across applicable workflows | transport adapter only | no deployed webhook route | conversation tables exist; no production store adapter | signature and in-memory journey tests | MISSING E2E |

## Executable boundary today

The source path reaches a pharmacist-owned canonical medicine decision and
read-only tenant inventory availability, while pharmacy staff can maintain the
same canonical stock through explicit commands. It does not presently execute
through patient nearby matching, compatible reservation, pharmacy
confirmation, pickup, notification, and WhatsApp completion. Therefore the
Golden Path remains `PARTIAL`, not complete.

## Required regression

Every subsequent slice must retain the already-tested upload, ARC,
pharmacist-authority and catalogue safety boundaries. No downstream workflow
may interpret an alternative as an automatic substitution or reserve inventory
before the approved medicine and tenant ownership are proven.
