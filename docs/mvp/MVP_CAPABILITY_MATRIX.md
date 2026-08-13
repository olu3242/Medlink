# MedLink MVP Capability Matrix

Date: 2026-07-31
Branch: `rc2-development`
North Star: Successful Prescription Fulfillment Rate

`Complete` means every required vertical-slice column is backed by executable
evidence. Existing scaffolds or source-only contracts are marked `Partial`.

| Capability | Business | Domain | Database | API | UI | AI | Security | Audit | Notifications | Tests | Documentation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity | Yes | Yes | Yes | Partial | Partial | N/A | Yes | Yes | N/A | Yes | Yes | Partial |
| Patient | Yes | Yes | Partial | Yes | Yes | N/A | Yes | Yes | N/A | Partial | Yes | Implemented |
| Pharmacy | Yes | Yes | Yes | Partial | Partial | N/A | Yes | Partial | Partial | Yes | Partial | Partial |
| Pharmacist | Yes | Partial | Partial | Partial | Partial | N/A | Yes | Partial | Partial | Partial | Partial | Partial |
| Medicine | Yes | Yes | Yes | Yes | Yes | N/A; no autonomous substitution | Yes | Yes | Versioned catalogue events | Yes | Yes | Implemented; runtime validation pending |
| Prescription | Yes | Yes | Yes | Yes | Yes | ARC scan/OCR/parsing | Yes | Yes | Versioned workflow events | Yes | Yes | Implemented; runtime validation pending |
| Clinical Review | Yes | Yes | Yes | Yes | Yes | Deterministic flags; human decision | Yes | Yes | Versioned workflow events | Yes | Yes | Implemented; runtime validation pending |
| Inventory | Yes | Yes | Yes | Yes | Yes | N/A; no autonomous stock action | Yes | Yes | Versioned inventory events | Yes | Yes | Implemented; runtime validation pending |
| Search | Yes | Yes | Yes | Partial | Yes | Partial | Yes | Partial | N/A | Yes | Partial | Partial |
| Reservation | Yes | Yes | Yes | Yes | Partial | N/A | Yes | Yes | Partial | Yes | Yes | Partial |
| Communication | Yes | Partial | Yes | Partial | Partial | Partial | Yes | Yes | Partial | Yes | Partial | Partial |
| Administration | Yes | Partial | Yes | Partial | Partial | N/A | Yes | Yes | Partial | Yes | Partial | Partial |

## ML-CAP-002 evidence

- Domain: `packages/patients`
- Database/RLS: `202607300015_mvp_patient_profiles.sql`
- Permissions: `patient:read`, `patient:manage`
- API: `/api/v1/patients/me` (`GET`, `POST`, `PATCH`, `DELETE`)
- UI: `/profile`
- Audit/observability: canonical `runApi` runtime journal, correlation, metrics,
  tracing, structured logs, and problem responses
- Tests: patient service, API validation contract, authorization, and automatic
  tenant RLS matrix

Certification remains pending because this environment has no Docker/Supabase
runtime. Migration `202607300015` and authenticated patient CRUD/RLS must pass
in an isolated RC2 database before the Database and Tests columns become
complete.

## ML-CAP-005 evidence

- Domain: `packages/medicine/src/canonical.ts`
- Database, RLS, atomic commands, version evidence, search, merge, and
  alternatives: `202607300019_canonical_medicine_catalog.sql`
- Repository adapter: `packages/medicine/src/supabase-catalog.ts`
- Administrator API: `/api/v1/medicines`, `/api/v1/ingredients`,
  `/api/v1/medicines/{id}`, `/api/v1/medicines/{id}/merge`, and
  `/api/v1/medicines/{id}/alternatives`
- Patient API: `/api/v1/medicines`, `/api/v1/medicines/{id}`,
  `/api/v1/medicines/search`, and
  `/api/v1/medicines/{id}/alternatives`
- UI: administrator `/catalog` and `/medicine/{id}`; patient `/medicines` and
  `/medicines/{id}`
- Safety boundary: only active records are patient-visible; every alternative
  explicitly requires independent pharmacist review and cannot authorize
  automatic substitution
- Evidence: canonical schema/service, migration invariant tests, event
  contracts, RBAC registry, strict TypeScript, targeted lint, and production
  builds

Implementation is complete. Live certification remains pending until migration
`202607300019` is applied to an isolated RC2 Supabase project and authenticated
tests prove platform-administrator writes, ordinary-user active-only reads,
cross-tenant command denial, idempotent replay, optimistic version conflicts,
immutable version evidence, duplicate merge behavior, and pharmacist-review
enforcement for alternatives.

## Next North Star gaps

1. Certify ML-WF-001 through ML-WF-008 against isolated Supabase and configured
   scanner/OCR/parser providers.
2. Complete pharmacy/pharmacist onboarding and live license verification.
3. Complete patient-facing nearby medicine search over the approved canonical
   medicine and the tenant-safe FEFO availability projection.
4. Complete reservation acceptance, fulfillment confirmation, notifications,
   and history.
5. Execute the four canonical workflows end to end in the pilot environment.

## ML-CAP-006 and ML-CAP-007 evidence

- ARC: `packages/agent-runtime` and ADR-0009
- Domain intake: `packages/prescription/src/intake.ts`
- Clinical pipeline: `packages/prescription/src/clinical-pipeline.ts`
- Pharmacist review: `packages/clinical/src/review.ts`
- Database, RLS, workflow and outbox:
  `202607300016_mvp_prescription_intake.sql` and
  `202607300017_pi1_clinical_pipeline.sql`
- API: `POST /api/v1/prescriptions`, `GET /api/v1/review`,
  `GET/PATCH /api/v1/review/{id}`, and the bearer-protected internal worker
- UI: `/prescriptions/new`, pharmacist `/`, and pharmacist `/review/{id}`
- Workflow contract: `WORKFLOW_REGISTRY.md`
- Evidence: ARC, intake, pipeline, review, event/migration contract, RLS matrix,
  PI-1 workflow acceptance, lint, TypeScript, and production builds

Implementation is complete, but pilot certification remains pending until an
isolated hosted execution verifies authenticated RLS, verified pharmacist
authorization, malware scanner behavior, private object access, provider
integration, fenced worker recovery, atomic workflow evidence, and
compensation.

## Batch 2: ML-CAP-007 and ML-CAP-008 evidence

- Pharmacist review domain and dashboard: `packages/clinical/src/review.ts`
  and `packages/clinical/src/dashboard.ts`
- Canonical medicine resolution, clarification history, atomic decision and
  patient re-review command:
  `202607310021_batch2_review_inventory_integration.sql`
- Pharmacist APIs/UI: `/api/v1/review`, `/api/v1/medicines/search`,
  `/api/v1/inventory/availability`, `/api/v1/dashboard`, the pharmacist
  workspace, and `/review/{id}`
- Patient clarification APIs/UI:
  `/api/v1/prescriptions/{id}/clarifications` and the prescription detail page
- Inventory domain/repository: `packages/inventory/src/management.ts` and
  `packages/inventory/src/supabase-inventory.ts`
- Inventory database, RLS, atomic stock commands, immutable ledger, FEFO
  availability and expiry recovery:
  `202607310020_pharmacy_inventory.sql`
- Pharmacy APIs/UI: `/api/v1/inventory`, item, stock, transaction and
  availability routes plus `/inventory/{id}`
- Events: medicine resolution, clarification response, inventory receipt,
  adjustment, reserve/release, dispense, return, expiry, low-stock and batch
  update contracts
- Local evidence: domain, migration, event, route-boundary and integrated
  clinical-to-inventory acceptance tests; strict TypeScript

Batch 2 status is **IMPLEMENTED; RUNTIME VALIDATION PENDING**. Docker-backed
Supabase is unavailable in this environment, so authenticated RLS, atomic
concurrency, migration apply/recovery, signed storage access and deployed
worker behavior are not certified.
