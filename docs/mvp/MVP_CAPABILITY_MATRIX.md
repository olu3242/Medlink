# MedLink MVP Capability Matrix

Date: 2026-07-30
Branch: `rc2-development`
North Star: Successful Prescription Fulfillment Rate

`Complete` means every required vertical-slice column is backed by executable
evidence. Existing scaffolds or source-only contracts are marked `Partial`.

| Capability | Business | Domain | Database | API | UI | AI | Security | Audit | Notifications | Tests | Documentation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity | ✓ | ✓ | ✓ | Partial | Partial | N/A | ✓ | ✓ | N/A | ✓ | ✓ | Partial |
| Patient | ✓ | ✓ | Partial | ✓ | ✓ | N/A | ✓ | ✓ | N/A | Partial | ✓ | Implemented |
| Pharmacy | ✓ | ✓ | ✓ | Partial | Partial | N/A | ✓ | Partial | Partial | ✓ | Partial | Partial |
| Pharmacist | ✓ | Partial | Partial | Partial | Partial | N/A | ✓ | Partial | Partial | Partial | Partial | Partial |
| Medicine | ✓ | ✓ | ✓ | ✓ | ✓ | Partial | ✓ | ✓ | N/A | ✓ | ✓ | Partial |
| Prescription | ✓ | ✓ | Partial | ✓ | ✓ | ARC scan task | ✓ | ✓ | OCR queued | Partial | ✓ | Implemented |
| Clinical Review | ✓ | ✓ | ✓ | ✓ | ✓ | Partial | ✓ | ✓ | Partial | ✓ | ✓ | Partial |
| Inventory | ✓ | ✓ | ✓ | Partial | Partial | N/A | ✓ | ✓ | Partial | ✓ | Partial | Partial |
| Search | ✓ | ✓ | ✓ | Partial | ✓ | Partial | ✓ | Partial | N/A | ✓ | Partial | Partial |
| Reservation | ✓ | ✓ | ✓ | ✓ | Partial | N/A | ✓ | ✓ | Partial | ✓ | ✓ | Partial |
| Communication | ✓ | Partial | ✓ | Partial | Partial | Partial | ✓ | ✓ | Partial | ✓ | Partial | Partial |
| Administration | ✓ | Partial | ✓ | Partial | Partial | N/A | ✓ | ✓ | Partial | ✓ | Partial | Partial |

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

## Next North Star gaps

1. Certify ML-WF-001 against isolated Supabase and the configured scanner.
2. Complete pharmacy/pharmacist onboarding and verification.
3. Connect approved prescriptions to medicine discovery and inventory results.
4. Complete reservation acceptance, fulfillment confirmation, notifications,
   and history.
5. Execute the four canonical workflows end to end in the pilot environment.

## ML-CAP-003 / ML-WF-001 evidence

- ARC: `packages/agent-runtime` and ADR-0009
- Domain intake: `packages/prescription/src/intake.ts`
- Database, RLS, workflow and outbox:
  `202607300016_mvp_prescription_intake.sql`
- API: `POST /api/v1/prescriptions`
- UI: `/prescriptions/new`
- Workflow contract: `WORKFLOW_REGISTRY.md`
- Evidence: ARC, intake and migration-contract tests

Database, security and test columns remain partial until an isolated hosted
execution verifies authenticated RLS, malware scanner behavior, private object
access, atomic workflow evidence and compensation.
