# MedLink MVP Workflow Registry

Version: 1.3

Date: 2026-07-30

Authority: MVP Constitution and Master Implementation Specification

MVP workflow identifiers use the `ML-WF-*` namespace. Earlier platform
catalogue identifiers remain unchanged for compatibility. `ML-CPP-001` is the
parent Prescription Clinical Processing Pipeline and reuses the existing
workflow runtime and transactional outbox.

| ID | Definition version | Capability | Terminal outcome | Status |
| --- | ---: | --- | --- | --- |
| ML-WF-001 Prescription Upload | 2 | ML-CAP-006 | Scanned private file, durable intake evidence, OCR work queued | Implemented; live certification pending |
| ML-WF-002 Prescription OCR | 1 | ML-CAP-006 | Immutable OCR result with confidence and provenance | Implemented; live certification pending |
| ML-WF-003 Prescription Parsing | 1 | ML-CAP-006 | Bounded structured prescription and field confidence | Implemented; live certification pending |
| ML-WF-004 Clinical Validation | 1 | ML-CAP-006 | Immutable clinical packet and findings routed to review | Implemented; live certification pending |
| ML-WF-005 Pharmacist Review | 1 | ML-CAP-007 | Audited licensed-pharmacist decision | Implemented; live certification pending |
| ML-WF-006 Manual Prescription Intake | 1 | ML-CAP-006 | Catalogue-linked draft or immutable review packet | Implemented; live certification pending |
| ML-WF-007 Canonical Medicine Governance | 1 | ML-CAP-005 | Versioned, audited canonical catalogue mutation | Implemented; live certification pending |
| ML-WF-008 Inventory Management & Availability | 1 | ML-CAP-008 | Audited stock ledger and tenant-safe FEFO availability | Implemented; runtime validation pending |

`ML-WF-001` version 1 is retained as immutable history. Version 2 corrects its
provisional capability reference from `ML-CAP-003` to canonical Prescription
Intake capability `ML-CAP-006`.

## ML-CPP-001 pipeline contract

```text
ocr
  -> parsing
  -> clinical_validation
  -> pharmacist_review
  -> completed | clarification
```

The parent run records current, previous, and next stage, attempt count,
correlation ID, timestamps, and identifier/hash-only output references. Child
workflow runs retain stage-specific evidence. The pipeline never stores OCR
text or clinical findings in workflow or outbox payloads.

## ML-WF-001 Prescription Upload

State:

```text
initialized -> validated -> stored -> queued_for_ocr -> completed
```

- Input: authenticated tenant/patient context, JPG/PNG/PDF content, MIME,
  filename, idempotency key, correlation ID.
- Output: prescription, immutable file evidence, extraction, upload workflow,
  and parent/stage workflow identifiers.
- Events: `prescription.upload.started.v1`,
  `prescription.uploaded.v1`, `prescription.validated.v1`,
  `prescription.stored.v1`, `prescription.queued-for-ocr.v1`,
  `prescription.upload.completed.v1`.
- Recovery: retry with the same idempotency key and content. Database failure
  compensates by deleting only the unreferenced object.
- Security: private tenant/patient path, 10 MB limit, signature/MIME validation,
  malware scan, SHA-256 evidence, RLS, and no PHI in outbox events.

## ML-WF-002 Prescription OCR

State:

```text
queued -> claimed -> running -> completed
                         \-> retrying -> claimed
                         \-> failed/dead_letter
```

- Input: immutable file identifier, signed private source reference, size,
  MIME, SHA-256, tenant/patient/prescription and workflow identifiers.
- Output: immutable OCR evidence with provider, model, page count, confidence,
  text, and result SHA-256. Only identifiers, hashes, and confidence leave the
  protected clinical store.
- Events: `prescription.ocr.completed.v1`,
  `prescription.ocr.low-confidence.v1`, and
  `prescription.queued-for-parsing.v1`.
- Runtime: ARC action `ocr`, 45-second task timeout, 60-second fenced lease,
  five attempts, exponential retry capped at five minutes, then dead letter.
- Recovery: stale workers cannot complete after lease expiry. A replay must
  carry the exact original result hash.

## ML-WF-003 Prescription Parsing

State:

```text
queued -> claimed -> running -> completed
                         \-> retrying -> claimed
                         \-> failed/dead_letter
```

- Input: immutable OCR evidence and pipeline identifiers.
- Output: one to thirty structured medicine items plus bounded optional header
  fields and per-field/overall confidence.
- Events: `prescription.parsed.v1`,
  `prescription.ambiguity-detected.v1`, and
  `prescription.queued-for-clinical-validation.v1`.
- Runtime: ARC action `prescription_parse` with the same timeout, lease, retry,
  replay, and dead-letter policy as OCR.
- Recovery: persistence of items, fields, workflow state, evidence hashes, and
  outbox events is atomic.

## ML-WF-004 Clinical Validation

State:

```text
queued -> claimed -> deterministic_validation -> packet_generated -> completed
```

- Input: immutable OCR evidence and structured extraction.
- Output: confidence/ambiguity findings and one immutable Clinical Evidence
  Object containing the source, OCR, structured extraction, findings, hashes,
  workflow references, and audit references.
- Events: `prescription.clinical-validation.completed.v1`,
  `prescription.clinical-packet.generated.v1`, and
  `prescription.pharmacist-review.requested.v1`.
- Policy: this stage performs deterministic quality validation only. It does
  not diagnose, recommend therapy, substitute medicine, or make a clinical
  decision, and therefore does not create a clinical AI run.
- Recovery: the stage uses the same fenced lease and retry/dead-letter policy;
  replay must match the immutable findings payload.

## ML-WF-005 Pharmacist Review

State:

```text
waiting -> pharmacist_decision
           -> approved
           -> rejected
           -> needs_information
```

- Input: RLS-protected Clinical Evidence Object and all persisted findings.
- Authority: only an active tenant member with role `pharmacist` and a current,
  verified pharmacist profile may decide.
- Rules: a bounded rationale is mandatory and every required finding must be
  explicitly acknowledged. Approval also requires every prescription item to
  be resolved to one active canonical medicine. Corrections are explicit,
  append-only review evidence; they are never autonomous substitutions. The
  database is the final authorization and transition authority.
- Events: `prescription.pharmacist-review.completed.v1` followed by exactly one
  of `prescription.clinically-approved.v1`,
  `prescription.clinically-rejected.v1`, or
  `prescription.clarification-requested.v1`; medicine resolution emits
  `prescription.medicine-resolution-recorded.v1`.
- Recovery: a decision is atomic and idempotent across finding
  acknowledgements, medicine resolutions, validation state, prescription
  state, workflow state, audit evidence, and outbox events. A patient response
  to a clarification preserves protected text history and creates a fresh
  pharmacist review; final clinical states remain immutable.

## ML-WF-006 Manual Prescription Intake

State:

```text
validated -> catalogue_resolved -> stored
                                  -> draft
                                  -> submitted -> ML-CPP-001/pharmacist_review
```

- Input: authenticated patient/tenant context, one to thirty active canonical
  medicine identifiers, prescription directions, optional prescriber/facility
  context, optimistic version, idempotency key, and correlation ID.
- Output: a patient-owned manual draft or a completed manual extraction,
  immutable evidence packet, and pending `ML-WF-005` review.
- Events: `prescription.manual-created.v1`,
  `prescription.manual-draft-updated.v1`,
  `prescription.manual-draft-deleted.v1`,
  `prescription.manual-submitted.v1`,
  `prescription.clinical-packet.generated.v1`, and
  `prescription.pharmacist-review.requested.v1`.
- Rules: medicine names and definitions are resolved from `medicines`;
  prescription items store the canonical FK and source snapshot rather than
  redefining medicines. Only an unsubmitted patient-owned manual draft can be
  replaced or soft-deleted. Submission is atomic and makes the clinical packet
  immutable.
- AI boundary: manual entry creates no AI run and never self-approves. It
  enters the same licensed-pharmacist decision boundary as uploaded
  prescriptions.
- Security: read RPCs expose only a patient-safe projection; storage paths,
  OCR text, findings, evidence, and decision rationale remain behind their
  existing clinical RLS policies.

## ML-WF-007 Canonical Medicine Governance

State:

```text
draft -> active -> retired
   \-> updated
duplicate -> validated -> merged_into_canonical
active_pair -> pharmacist-reviewed alternative
```

- Input: platform-administrator tenant context, complete medicine document,
  canonical active ingredients, optional aliases, regulatory registrations,
  expected version, idempotency key, and correlation ID.
- Output: normalized and versioned medicine master, immutable catalogue
  evidence, and identifier-only outbox/audit events.
- Events: `medicine.ingredient-created.v1`,
  `medicine.catalog-created.v1`, `medicine.catalog-updated.v1`,
  `medicine.catalog-merged.v1`, and `medicine.alternative-created.v1`.
- Rules: activation requires regulatory registration. Merge is permitted only
  for clinically identical generic, strength, form, route, controlled status,
  and ingredient sets, and aborts on inventory-batch collision.
- Search: ranks exact brand/generic matches first and also indexes active
  ingredient, manufacturer, registration, and synonym fields.
- Safety: alternative links always set `requires_pharmacist_review`; they
  neither change a prescription nor authorize substitution.
- Security: ordinary authenticated users can project active medicines and
  their active metadata only. Global catalogue writes require a platform
  administrator who is also a member of the event/audit tenant.
- Recovery: mutations are atomic and idempotent. Stale expected versions fail
  closed; retry uses the same idempotency key and exact content.

## ML-WF-008 Inventory Management & Availability

State:

```text
catalogue-linked batch -> active -> low-stock | expiring -> expired/inactive
stock movement -> validate -> atomically apply -> ledger/event/audit
```

- Input: active canonical `medicine_id`, tenant-owned pharmacy location,
  batch/expiry/unit metadata, bounded price/currency pair, optimistic version,
  explicit stock operation, idempotency key and correlation context.
- Output: inventory batch, derived `available = on_hand - reserved`, immutable
  stock transaction and FEFO availability projection.
- Operations: receive, adjustment, reserve, release, dispense, return and
  expiry. A generic database update cannot change stock totals.
- Events: `inventory.batch-updated.v1`, `inventory.received.v1`,
  `inventory.adjusted.v1`, `inventory.reserved.v1`,
  `inventory.released.v1`, `inventory.dispensed.v1`,
  `inventory.returned.v1`, `inventory.expired.v1` and `inventory.low.v1`.
- Authority: pharmacy owner/staff/inventory manager may perform permitted
  commands; pharmacist access is read-only. Patients have no inventory
  management permission. RLS and command functions enforce organization and
  pharmacy-location ownership.
- Reliability: stock invariants are database constraints, commands lock the
  target batch, use optimistic version and idempotency evidence, and write the
  batch, ledger, audit and outbox atomically. The token-protected expiry worker
  recovers expired stock in bounded batches.
- UI: responsive pharmacy inventory list/create/detail, explicit stock
  operations and ledger; pharmacist review shows read-only availability after
  canonical medicine resolution.
- AI boundary: no ARC task makes clinical or inventory decisions.

## Certification boundary

Implementation evidence includes domain, ARC, migration-contract, event
contract, workflow acceptance, strict TypeScript, lint, and production-build
tests. Pilot certification remains pending until migrations `017` through
`021` are applied to an isolated RC2 Supabase project and authenticated
multi-tenant execution proves RLS, storage access, worker leasing/recovery,
provider calls, workflow state, immutable evidence, human authorization,
inventory concurrency/invariants, idempotent replay, expiry recovery and
outbox behavior end to end.
