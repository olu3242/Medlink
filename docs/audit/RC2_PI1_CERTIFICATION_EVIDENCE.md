# RC2 PI-1 Certification Evidence

Date: 2026-07-30  
Branch: `rc2-development`  
Baseline parent: `d33bd6858e46952083dee4324a16eb90064b816d`  
Scope: `ML-CPP-001`, `ML-WF-002` through `ML-WF-005`,
`ML-CAP-006`, `ML-CAP-007`

## Decision

```text
Source implementation       VERIFIED
Local automated validation  PASS
Representative integration  PENDING
Pilot certification         NOT AUTHORIZED
```

PI-1 is Implemented and locally Verified. It is not Pilot Certified because
this execution environment cannot produce representative Supabase, storage,
provider, or authenticated tenant evidence.

The Batch 2 checkpoint extends the pharmacist-review portion with canonical
item resolution, clarification re-review and inventory availability. Its
separate evidence record is `RC2_BATCH2_CERTIFICATION_EVIDENCE.md`; it does not
change PI-1's blocked live-certification decision.

## Delivered evidence

| Domain | Evidence | Result |
| --- | --- | --- |
| Domain | Strict OCR/structured parsing contracts, deterministic quality findings, pharmacist review service | Pass |
| Workflow | Parent pipeline plus stage lifecycle, child workflow runs, retries, timeouts, recovery and terminal human decision | Pass |
| Transaction | Forward-only migration with atomic completion/decision functions and existing transactional outbox | Static pass; live pending |
| ARC | OCR/parsing use policy and telemetry; clinical validation/decision are not autonomous AI tasks | Pass |
| Security | Service-role-only workers, constant-time worker bearer, verified pharmacist gate, final-state guards, private evidence, PHI event boundary | Static pass; live RLS pending |
| Reliability | Fenced leases, `SKIP LOCKED`, retry/backoff, exact replay, dead-letter path | Static/unit pass; live concurrency pending |
| API | Versioned review contracts plus protected internal worker and canonical problem/runtime handling | Pass |
| UI | Pharmacist queue, evidence detail, required acknowledgements, rationale and idempotent decision | Production build pass; authenticated acceptance pending |
| Audit/observability | Workflow events, governance audit, ARC telemetry, correlation and safe identifiers/hashes | Pass |
| Operations | Clinical intake runbook and PI-1 risk register | Pass |

## Automated validation

Executed successfully during this implementation:

- strict TypeScript for all applications/packages;
- repository lint;
- migration/RLS focused suite: 70 tests;
- ARC, event contract, clinical pipeline, review, and migration focused suite:
  27 tests;
- in-memory PI-1 acceptance: upload evidence -> OCR -> parsing ->
  deterministic validation -> review -> pharmacist approval;
- optimized production builds for `web`, `patient`, and `pharmacist`.

The final repository-wide test/build totals are recorded in the delivery
checkpoint after all authorized engines in the current task complete.

## Evidence chain

- Migration:
  `supabase/migrations/202607300017_pi1_clinical_pipeline.sql`
- Domain:
  `packages/prescription/src/clinical-pipeline.ts`
- Review:
  `packages/clinical/src/review.ts`
- Event contracts:
  `packages/api/src/events.ts`
- Worker:
  `apps/web/app/api/internal/clinical-pipeline/route.ts`
- Pharmacist API/UI:
  `apps/pharmacist/app/api/v1/review` and
  `apps/pharmacist/app/review`
- Tests:
  `clinical-pipeline.test.ts`, `review.test.ts`,
  `pi1-migration.test.ts`, `contracts.test.ts`, and
  `clinical-intake-pi1.test.ts`
- Specification: `docs/mvp/RC2_PI1_CLINICAL_INTAKE.md`
- Workflow registry: `docs/mvp/WORKFLOW_REGISTRY.md`
- Operations: `docs/runbooks/clinical-intake-pipeline.md`
- Risks: `docs/audit/RC2_PI1_RISK_REGISTER.md`

## Mandatory representative-environment checks

1. Apply migrations `016` and `017` to a clean isolated RC2 Supabase project.
2. Validate authenticated allow/deny RLS for two tenants, patient, verified
   pharmacist, unverified pharmacist, tenant admin, and service role.
3. Validate private object upload/read boundaries and signed download expiry.
4. Execute approved scanner, OCR, and parser canaries without PHI in logs.
5. Prove concurrent claim fencing, lease expiry/reclaim, retry, dead letter,
   and exact replay behavior.
6. Prove final decisions require current license verification and all finding
   acknowledgements.
7. Verify domain/workflow/audit/outbox evidence and hashes for approve, reject,
   clarification, provider failure, and stale worker scenarios.
8. Capture operational metrics, representative safe logs, authenticated UI
   evidence, and approver sign-off.

## Residual risk

Open items are tracked in `RC2_PI1_RISK_REGISTER.md`. No source test or build
failure is currently known. The absence of representative evidence is a
certification blocker, not evidence of a pass.
