# RC1 Pilot Readiness Review (Engine 40)

Executive synthesis of this program's documents
(`WORKFLOW_CATALOG.md`, `WORKFLOW_DEPENDENCY_MATRIX.md`,
`WORKFLOW_CERTIFICATION.md`, `FAILURE_TEST_MATRIX.md`,
`CLINICAL_SAFETY_CERTIFICATION.md`, `MULTITENANT_SECURITY_REPORT.md`,
`PILOT_SIMULATION_RESULTS.md`) plus the pre-existing
`docs/release/rc1-ga/GA_DECISION.md` and `docs/audit/LAUNCH_GAP_MATRIX.md`.
This document does not override `GA_DECISION.md`'s authority on GA
readiness; it extends it with evidence gathered since that document was
written, for the narrower question of controlled-pilot readiness. See
`FINAL_GO_NO_GO.md` for the verdict itself.

## Engineering

- Build status: **pass**. All four open PRs (#5 Agent Governance Layer,
  #6 WhatsApp webhook, #7 Launch Gap Matrix, #8 Prescription Intake)
  merge cleanly into each other (one trivial test-file append conflict,
  resolved) and the combined tree passes `npm run check` (572 tests, 8
  skipped live-DB, 0 failed) and `npm run build` (all 8 workspaces).
- Test status: strong at the unit/contract level throughout; zero live
  integration, RLS, or concurrency evidence anywhere in the repository --
  a structural sandbox limitation, not a quality gap (see every "Blocked"
  row across this program's documents).
- Runtime health: `apps/web`'s `/health/{startup,ready,live,details}`
  endpoints are real and dependency-checked (not hardcoded), per prior
  session work; never exercised against a live deployment in this
  program.

## Security

- Secrets: two real, historical leaked credentials (Supabase anon-key
  JWT, DB password) confined to `fix/rc1-readiness` commit `9a5686e`,
  confirmed unreachable from `main`, flagged for rotation independent of
  any launch decision (found and reported at the start of this session's
  AGL-1..5 work, unchanged since).
- RBAC: source-complete and content-tested (`packages/platform/src/authorization.ts`,
  100% coverage); every clinical/access RPC re-enforces role checks
  independent of RLS (`CLINICAL_SAFETY_CERTIFICATION.md` item 3).
- RLS: 57 tenant tables statically verified to have RLS enabled and at
  least one policy (`rls-matrix.test.ts`); zero live authenticated
  cross-tenant probes have ever run (`MULTITENANT_SECURITY_REPORT.md`).
- Storage: new this program (PR #8) -- a private, RLS-scoped bucket for
  prescription images exists in source, never applied to a live instance.
- Dependency audit: `npm audit` shows 3 high-severity findings today (all
  requiring a `next` major-version bump); `DEPENDENCY_RISK_REGISTER.md`'s
  "15 high" claim is stale (flagged in `LAUNCH_GAP_MATRIX.md`).

## Clinical

- Governance: pharmacist authority is structurally protected -- no agent
  capability can call a clinical decision RPC (type-level and
  runtime-level enforcement), every decision requires a genuine
  authenticated actor, `CLINICAL_SAFETY_CERTIFICATION.md`.
- Review process: WF-007's validation and decision steps are real,
  atomic, and idempotent-replay-safe; the clarification
  (`needs_information`) round-trip has **no implementation found** --
  the single clearest clinical-workflow gap this program identified.
- Safety controls: finalized clinical reviews are immutable by trigger;
  `clinical_findings` is **not** similarly guarded -- a real, scoped gap,
  not previously documented, recommended for a small follow-up fix.

## Operations

- Runbooks exist (`docs/runbooks/production-operations.md`,
  `enterprise-service-operations.md`) but this program did not audit
  their content against current system state -- out of this pass's
  scope (Batch 5 territory per the program's own sequencing).
- Incident response, monitoring, and support processes: not evaluated in
  this pass; `GA_DECISION.md` already lists "production deployment/
  rollback," "hypercare exit," and "compliance evidence review" as OPEN.
- `PILOT_SIMULATION_RESULTS.md`: no operational load has been simulated
  or measured; recommends a single real manual walkthrough over synthetic
  simulation, once the chaining gaps below are closed.

## Product

- MVP scope confirmation: `WORKFLOW_CATALOG.md`'s per-workflow detail is
  the most precise scope statement this repository currently has --
  9 of 15 canonical workflows have at least one real step; 6 (Pickup,
  Delivery, Reminder, Consultation, Refill, Completion) are structural
  only, consistent with `docs/release-scope.md`'s Wave 4/5 sequencing,
  not an oversight.
- Deferred backlog: see this program's separate Post-RC1 roadmap
  deliverable (not built in this pass -- flagged for the next round,
  since it was requested as part of Batch 5, not Batch 4).
- Known limitations, the ones that matter most for a pilot go/no-go:
  **no OCR**, **no outbound notification of any kind**, **no
  patient-to-reservation workflow chaining**, **no live multi-tenant
  isolation proof**.

## Risk register (evidence-backed, carried into `FINAL_GO_NO_GO.md`)

| Severity | Risk | Evidence |
| --- | --- | --- |
| Critical | No workflow completes end-to-end without manual intervention at 3+ points | `WORKFLOW_DEPENDENCY_MATRIX.md` "Chaining gaps" |
| Critical | Zero outbound notification of any kind | `LAUNCH_GAP_MATRIX.md` G09, re-confirmed this pass |
| Critical | Zero live multi-tenant isolation verification | `MULTITENANT_SECURITY_REPORT.md`, all 6 adversarial scenarios Blocked |
| Critical | Reservation inventory-conflict race has never been proven under real concurrency | `FAILURE_TEST_MATRIX.md` |
| High | No OCR; prescription review is fully manual transcription | `LAUNCH_GAP_MATRIX.md` G05, `PRESCRIPTION_INTAKE_CERTIFICATION.md` |
| High | Clarification (`needs_information`) round-trip has no implementation | `CLINICAL_SAFETY_CERTIFICATION.md` item 5 |
| High | `clinical_findings` has no immutability guard | `CLINICAL_SAFETY_CERTIFICATION.md` item 4 |
| High | `OutboxDispatcher` (retry/dead-letter) has zero tests and zero live callers | `FAILURE_TEST_MATRIX.md` |
| Medium | Invalid-JWT/expired-session/missing-tenant failure paths have no test coverage (missing-tenant and timeout are cheap to close without live infra) | `FAILURE_TEST_MATRIX.md` |
| Medium | `apps/web` has no medicine-search adapter of its own; `medicine_search` doesn't complete from a live WhatsApp message | `WHATSAPP_RUNTIME_CERTIFICATION.md`, `WORKFLOW_CATALOG.md` |
| Low | Two historical leaked credentials need rotation (confirmed not on `main`) | this document's Security section |
| Low | `npm audit` count in `DEPENDENCY_RISK_REGISTER.md` is stale | `LAUNCH_GAP_MATRIX.md` |
