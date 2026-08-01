# RC1 Canonical Workflow Catalog (Engine 34)

Date: 2026-08-01. Evidence basis: a local integration merge of `main` +
PR #5 (Agent Governance Layer) + PR #6 (WhatsApp webhook) + PR #7 (Launch
Gap Matrix) + PR #8 (Prescription Intake) -- `npm run check` (572 tests
passed, 8 skipped, 0 failed) and `npm run build` (all 8 workspaces) both
pass on the combined tree, confirming the four open PRs are mutually
compatible. Not pushed; a verification step only. Every status below cites
a specific file.

## Status legend

- **Implemented**: has a real, executable, tested `WorkflowStep` and/or
  route, backed by a real migration/RPC.
- **Partially Implemented**: some steps real, others still name-only; or
  a real step exists but nothing invokes it from a live entry point yet.
- **Structural only**: `workflowDefinitions` names the step sequence
  (`packages/workflows/src/definitions.ts`); no executable step exists.
- **Deferred**: explicitly out of RC1 scope per `docs/release-scope.md`.

## Patient lifecycle mapping

```
Patient -> WhatsApp -> Conversation Runtime -> Prescription Intake -> Storage
  -> Pharmacist Review -> Medicine Matching -> Inventory Search -> Reservation
  -> Patient Notification -> Pharmacy Fulfillment -> Audit -> Reporting
```

| Lifecycle stage | Canonical workflow(s) | Status |
| --- | --- | --- |
| WhatsApp entry | (no WF id -- see "Non-WF-numbered runtime capabilities") | Implemented (PR #6) |
| Conversation Runtime | (same) | Implemented (PR #6) |
| Prescription Intake / Storage | WF-003 | Partially Implemented |
| Prescription Parsing | WF-004 | Partially Implemented |
| Pharmacist Review | WF-007 | Partially Implemented |
| Medicine Matching | WF-005 | Partially Implemented |
| Inventory Search | WF-008 | Partially Implemented |
| Reservation | WF-006, WF-009 | Partially Implemented |
| Patient Notification | (none) | **Structural only -- see G09** |
| Pharmacy Fulfillment | WF-010, WF-011 | Structural only |
| Audit | (cross-cutting, not a WF id) | Implemented |
| Reporting | (none) | Not built as a workflow |

No lifecycle stage above is fully "Implemented" end-to-end today. Every
"Partially Implemented" workflow has a real, atomic, tested backing RPC or
step for at least one transition, but no live route chains more than one
workflow together yet -- see `WORKFLOW_DEPENDENCY_MATRIX.md`'s "chaining"
column.

## Per-workflow detail

### WF-001 Patient Registration -- Structural only

- Steps (name only): `collect_identity`, `verify_channel_identity`,
  `create_patient_profile`, `link_conversation_identity`.
- No executable `WorkflowStep`, no dedicated registration route anywhere
  in `apps/*` (`find apps -ipath "*regist*" -o -ipath "*signup*"` returns
  nothing).
- **What actually happens instead**: Supabase Auth's own OTP sign-in
  (`apps/web/app/auth/sign-in/actions.ts`'s `signInWithOtp`) implicitly
  provisions a new `auth.users` row on first verification -- registration
  is handled entirely by the auth provider, not by this workflow. This is
  a real, working capability; it just isn't the WF-001 orchestration this
  catalog entry names.
- Owner: none assigned. Dependencies: Supabase Auth. Tests: none specific
  to this workflow.

### WF-002 Authentication -- Structural only (capability real, workflow wrapper is not)

- Steps (name only): `verify_channel_identity`, `resolve_session`.
- Same situation as WF-001: real authentication exists
  (`signInWithOtp`/`auth.getUser()`, used by every `runApi`/`runWebApi`
  call), but not as a WF-002-shaped orchestrated workflow.

### WF-003 Prescription Upload -- Partially Implemented

- Steps: `receive_media` (structural only), `store_prescription_record`
  (**real**, `packages/workflows/src/prescription-upload.ts`).
- Real backing: `create_prescription_record` RPC (migration
  `202607290008`, extended by PR #8's migration `202608010003` with
  checksum/mime/size + duplicate detection).
- Real route (PR #8): `POST /api/v1/prescriptions` in `apps/patient`,
  going through `PrescriptionIntakeApplication` -- **but this route does
  not construct a `WorkflowStep`/invoke the Workflow Orchestrator; it
  calls the RPC directly.** The `createPrescriptionUploadStep` in
  `prescription-upload.ts` exists, is tested, and is importable by a
  future workflow-orchestrated caller, but nothing currently invokes it.
- `receive_media` (accepting a WhatsApp-delivered image/document) is not
  implemented as a distinct step; the closest real capability is PR #6's
  webhook route recording an inbound message with `contentType: "image"`
  and no further processing (the `ConversationEngine` hands off to a
  human, since `prescription_upload` has no wired workflow step in
  `WorkflowOrchestratorInvoker`).
- Tests: `packages/workflows/src/prescription-upload.test.ts`,
  `apps/patient/lib/prescription-intake.test.ts`.

### WF-004 Prescription Parsing -- Partially Implemented

- Steps: `run_extraction` (**real**,
  `packages/workflows/src/prescription-parsing.ts`), `route_to_clinical_review`
  (structural only).
- Real backing: `record_prescription_extraction` RPC (migration
  `202607290009`) against `apps/admin/lib/prescription-extraction.ts`'s
  `SupabasePrescriptionRepository` -- but per
  `docs/audit/LAUNCH_GAP_MATRIX.md`'s G05 finding, **there is no OCR
  provider anywhere in this codebase**; this step records whatever
  structured extraction data it's handed, it does not produce that data
  from an image itself.
- Route: `POST /api/v1/prescriptions/{id}/extract` in `apps/admin`
  (staff-facing, not patient-facing).
- Tests: `packages/workflows/src/prescription-parsing.test.ts`.

### WF-005 Medicine Search -- Partially Implemented, the most complete workflow

- Steps: `parse_query` (structural), `search_catalog` (**real**,
  `packages/workflows/src/medicine-search.ts`), `return_matches` (structural,
  effectively covered by the step's own return value).
- Real backing: `TrigramMedicineSearchIndex`/`SupabaseSearchMedicineReader`
  (`apps/admin/lib/medicine-search.ts`), `GET /api/v1/search` in
  `apps/admin`.
- **The only workflow actually reachable through the Workflow
  Orchestrator today**: `apps/web/lib/workflow-invoker.ts`'s
  `WorkflowOrchestratorInvoker` wires this step to
  `packages/conversation`'s `WorkflowInvoker` port for the
  `medicine_search` intent -- but PR #6's real webhook route uses
  `UnwiredWorkflowInvoker` instead (`apps/web` has no medicine-search
  adapter of its own; one exists only in `apps/admin`), so even this
  workflow doesn't complete end-to-end from a live WhatsApp message today.
- Tests: `packages/workflows/src/medicine-search.test.ts`,
  `apps/web/lib/workflow-invoker.test.ts` (fake search service only).

### WF-006 Medication Access Request -- Partially Implemented

- Steps: `create_mar` (**real**, `packages/workflows/src/mar-creation.ts`),
  `validate_mar` (structural as a *workflow step*, though the underlying
  `validate_mar` RPC is real -- see below).
- Real backing: `create_mar` RPC (migration `202607290016`), `validate_mar`
  RPC (migration `202607290018`, transitions `created -> validated`),
  `decide_clinical_review` extended (migration `202607290019`) to advance
  `validated -> reviewed` on approval.
- No patient-facing route creates a MAR directly from this workflow; MAR
  creation today is reachable via `apps/patient/lib/application.ts`'s
  `AccessApplication.createMar()`.
- Tests: `packages/workflows/src/mar-creation.test.ts`, plus migration
  certification blocks in `packages/runtime/src/migration.test.ts`.

### WF-007 Clinical Review -- Partially Implemented

- Steps: `run_clinical_validation` and `pharmacist_review`, **both real**
  (`packages/workflows/src/clinical-review.ts`).
- Real backing: `record_clinical_validation` RPC (migration
  `202607290009`, idempotency-keyed as of this session's Codex-review
  fix), `decide_clinical_review` RPC (migration `202607290017`, made
  atomic and concurrency-safe this session), three real advisory rules
  (`DuplicateTherapyRule`, `PatientAllergyRule`, `PolypharmacyRiskRule`,
  `packages/clinical/src/validation.ts`).
- Routes: `POST /api/v1/prescriptions/{id}/validate` (`apps/admin`),
  `PATCH /api/v1/review/{id}` (`apps/patient`),
  `apps/pharmacist/app/review/[id]/page.tsx` (not verified in this pass
  whether it's a full queue view or a single-case detail view -- flagged
  as an open question in `docs/audit/LAUNCH_GAP_MATRIX.md`'s G06 section).
- Tests: `packages/workflows/src/clinical-review.test.ts`,
  `packages/clinical/src/validation.test.ts`.

### WF-008 Inventory Discovery -- Partially Implemented

- Steps: `search_inventory` (**real**,
  `packages/workflows/src/inventory-discovery.ts`), `match_inventory`
  (structural).
- Route: `GET /api/v1/inventory` (`apps/patient`).
- **Not MAR-scoped**: this step searches inventory generally; nothing
  connects a specific MAR's `searching`/`matched` state transitions to an
  inventory search result (`docs/audit/RC1_BACKLOG.md` item 19, still
  open -- confirmed unchanged in this pass).
- Tests: `packages/workflows/src/inventory-discovery.test.ts`.

### WF-009 Reservation -- Partially Implemented

- Steps: `reserve_inventory`, **real**
  (`packages/workflows/src/reservation.ts`).
- Real backing: `reserve_inventory` RPC (migration `202607290010`,
  replay-validated against the original request as of this session's
  Codex-review fix), requires MAR `state = 'matched'` -- which, per WF-008's
  gap above, no MAR can currently reach through any live route.
- Route: `POST /api/v1/reservations` (`apps/patient`), but per
  `docs/audit/ENGINE_STATUS_MATRIX.md`'s Reservation row, the reservation
  UI (`apps/patient/app/reserve/[inventoryId]/page.tsx`) posts only
  `{inventoryId}`, missing the `marId`/`pharmacyLocationId`/`quantity`/
  `expiresAt` the RPC requires -- confirmed still true in this pass.
- Tests: `packages/workflows/src/reservation.test.ts`, plus this
  session's concurrency-relevant migration certification (static, not
  live -- see `FAILURE_TEST_MATRIX.md`).

### WF-010 Pickup -- Structural only

Steps named (`generate_pickup_code`, `confirm_pickup`); no executable step,
no route, no backing RPC found.

### WF-011 Delivery -- Structural only

Steps named (`schedule_delivery`, `confirm_delivery`); no executable step.
Per `docs/release-scope.md`, courier/delivery orchestration is explicitly
Wave 5/RC2 scope -- this is expected, not a gap.

### WF-012 Medication Reminder -- Structural only

Steps named (`schedule_reminder`, `send_reminder`); no executable step. Also
blocked on G09's complete absence of outbound notification delivery (see
`docs/audit/LAUNCH_GAP_MATRIX.md`).

### WF-013 Consultation -- Structural only

Steps named (`request_consultation`, `assign_pharmacist`,
`complete_consultation`); no executable step, no route.

### WF-014 Refill -- Structural only

Steps named (`locate_prior_mar`, `create_refill_mar`); no executable step.
Would likely reuse `create_mar`'s RPC once built, but nothing does yet.

### WF-015 Workflow Completion -- Structural only

Steps named (`finalize_mar`, `emit_completion_event`); no executable step.

## Non-WF-numbered runtime capabilities

Two real, tested, PR-scoped capabilities sit outside the WF-001..015
numbering entirely -- worth cataloging since the patient lifecycle diagram
names them as stages:

- **WhatsApp Conversation Runtime** (PR #6): `apps/web/app/api/whatsapp/webhook/route.ts`.
  Inbound message reception, signature verification, duplicate-delivery
  idempotency, conversation state, human handoff -- real and tested. Not a
  canonical workflow in `definitions.ts`; it's the Conversation Engine
  (`packages/conversation`) profile ADR 0004 authorizes, which *invokes*
  canonical workflows (today, none successfully, since `apps/web` uses
  `UnwiredWorkflowInvoker` -- see WF-005 above).
- **Agent Governance Layer** (PR #5): `packages/agents`. Not a workflow
  itself -- a governance layer *around* how a future automated agent could
  participate in these workflows (capability registry, memory, planning,
  coordination, human-supervision escalation). No production route
  invokes any of it yet; it exists to constrain future automation, not to
  execute anything today.

## Certification status summary

| Workflow | Steps real | Route wired | Chained to adjacent workflow | Certification status |
| --- | --- | --- | --- | --- |
| WF-001 | 0/4 | No | -- | Structural (capability handled outside workflow model) |
| WF-002 | 0/2 | No | -- | Structural (capability handled outside workflow model) |
| WF-003 | 1/2 | Yes (direct RPC, not via WorkflowStep) | No | Partial |
| WF-004 | 1/2 | Yes (staff-facing) | No | Partial, OCR gap |
| WF-005 | 1/3 | Yes (admin search only; not from WhatsApp) | No | Partial |
| WF-006 | 1/2 (+2 real non-workflow RPCs) | No | No | Partial |
| WF-007 | 2/2 | Yes | No | Partial (queue UX unverified) |
| WF-008 | 1/2 | Yes | No (not MAR-scoped) | Partial |
| WF-009 | 1/1 | Yes (UI payload incomplete) | No | Partial |
| WF-010 -- WF-015 | 0/N each | No | -- | Structural only |
