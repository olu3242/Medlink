# RC1 Certification Gap

## Current result

**CONDITIONAL PASS — architecture baseline only**

This audit certifies that repository gaps are identified and prioritized. It
does not certify RC1 or any engine for production.

## Gate evidence

| Gate | Result | Evidence/gap |
| --- | --- | --- |
| Lint | Pass | `npm run lint` |
| Unit/runtime/architecture tests | Pass | 38 files, 99 tests |
| Live database runtime tests | Blocked | One suite skipped; Docker/Podman unavailable |
| Root typecheck | Pass | Covers all apps and packages |
| Migrated app builds | Pass | All 8 app workspaces (`npm run build --workspaces --if-present`) |
| Coverage | Conditional | `vitest.config.ts` enforces a 70/70/65/70 statements/branches/functions/lines gate over `packages/**/src`, uploaded as a CI artifact; apps/** UI and route handlers remain uncovered by design pending the integration/e2e suite in the backlog |
| Migration apply | Not evidenced | Migrations 001-010 statically certify; no PostgreSQL/Supabase runtime (network egress policy blocks the container-registry pulls `supabase start` needs — see `docs/audit/RC1_SPRINT_REPORT.md` Phase 1) |
| RLS runtime | Fail | No cross-tenant test suite |
| API integration | Fail | No integration suite |
| API architecture contracts | Pass | Protected v1 routes enforce canonical boundaries |
| API integration contracts | Fail | No live-database/provider contract suite |
| Workflow identity | Pass | All 15 stable IDs are executable contracts |
| Workflow behavior | Fail | Canonical end-to-end workflow suites are absent, and could not pass today regardless: `searching`/`matched` transitions still have no implementation, so no MAR can legally reach `reserve_inventory`'s precondition even though `validated`/`reviewed` are now real — see Wave 3 section below |
| CDA conformance | Conditional | Conversation Engine domain/application boundaries and schema exist (`packages/conversation`, migration `202607290012`); WhatsApp channel-adapter transport slice exists (`packages/whatsapp`, migration `202607290013`); route wiring is now closed (ADR 0004 accepted, `apps/web/app/api/whatsapp/webhook/route.ts` calls `createRuntime()` for real — see RC1_BACKLOG item 15); still open: no route wires a workflow requiring an actor-checked mutation, and the `auth.users` system-identity migration lacks live-Supabase execution evidence |
| Audit/event completeness | Conditional | General outbox exists (migration 006); Wave 2 catalog/prescription/equivalency/clinical-validation use cases (migrations 008-009) and reservation creation (migration 010) all commit business state, audit, and outbox atomically in one function; MAR pickup/fulfillment transitions and other unimplemented Wave 3 use cases remain out of scope until built |
| Observability | Fail | No metrics/tracing/SLO evidence; health dependency checks are now real (no hardcoded results) but still unexercised outside unit tests |
| Performance | Not evidenced | No load/latency evidence |
| Security | Conditional | Static controls exist; no threat/pen evidence. `npm audit`: 15 high-severity findings, all requiring a major-version bump with no non-breaking fix available (`npm audit fix` alone resolves none of them) — see `docs/audit/DEPENDENCY_AUDIT.md` for the per-package risk assessment and why none were force-upgraded unilaterally |
| Backup/restore/DR | Not evidenced | No exercise reports |
| External conformance | Not evidenced | No provider/partner environments |
| Documentation | Conditional | Governance aligned; legacy docs conflict |
| Enterprise runtime lifecycle | Conditional | Audit/outbox journal is atomic; Wave 2 catalog/prescription use cases integrate it into a single business-state transaction, MAR/reservation use cases do not yet, and live evidence remains blocked by the absence of a runtime PostgreSQL/Supabase environment |

## Certification gaps by wave

### Wave 1

- Canonical API pipeline is now used by every route in `apps/admin`, `apps/patient`,
  and `apps/web` (the one stale non-conformant route, `apps/web/app/api/v1/health`,
  was dead code duplicating the real `apps/web/app/health/*` surface and was
  removed rather than remediated in place).
- Workspace build now covers all 8 app workspaces and a coverage threshold is
  enforced over `packages/**/src`; apps/** still lack integration/e2e coverage.
- Runtime RLS, observability, secrets, backup, and recovery evidence is absent.

### Wave 2

- Domain unit tests are positive but narrow.
- Medicine and prescription creation/update now commit business state and
  runtime evidence atomically (migration 008); other application repositories
  remain thin pass-throughs.
- The generic-medicine-entity gap is resolved: migration 202607290011 adds a
  first-class `generics` table, backfilled from existing data and kept in
  sync by trigger; `findGenericById`/`findGenericsByIds`/generic-type search
  now query it for real instead of returning `null`/`[]`/no-hits
  unconditionally.
- OCR provider, API integration, RLS, search adapter, clinical rule evidence,
  and batch certification are incomplete.

### Wave 3

- Conversation Engine domain/application boundaries and schema now exist
  (`packages/conversation`, migration `202607290012`) — dialogue/session
  state, intent detection, human handoff, and an append-only decision log,
  delegating business processes to a `WorkflowInvoker` port rather than
  running rules itself.
- The WhatsApp channel adapter's transport slice now exists
  (`packages/whatsapp`: signature verification, payload normalization,
  outbound sender) and `conversation_channel_bindings` (migration
  `202607290013`) resolves which organization a channel identifier belongs
  to. **Route wiring is now closed**: ADR 0004 is accepted, and
  `apps/web/app/api/whatsapp/webhook/route.ts` calls `createRuntime()`'s
  `run()` for real — signature-verified, tenant-resolved, idempotent on
  retry, and non-crashing on an unwired workflow (hands off to a human
  instead). See `docs/audit/RC1_BACKLOG.md` P1 item 15 and
  `docs/audit/WHATSAPP_RUNTIME_CERTIFICATION.md` for full evidence and what
  remains open (medicine-search-over-WhatsApp needs its own adapter in
  `apps/web`; the system-identity migration needs live-Supabase
  execution).
- Batch 3.2 groundwork: `packages/workflows` now carries context between
  steps, all 15 canonical workflows have a structural step-name
  definition, and WF-005 (Medicine Search), WF-006 (Medication Access
  Request), and WF-007 (Clinical Review) each have one real executable
  step. `workflow_instances` (migration `202607290015`) gives it a
  persisted `SupabaseWorkflowStore`, and
  `apps/web/lib/workflow-invoker.ts`'s `WorkflowOrchestratorInvoker` wires
  `packages/conversation`'s `WorkflowInvoker` port to it -- runs
  `medicine_search` for real, throws `UnsupportedWorkflowTypeError` (not a
  silent no-op) for any other classified intent. No route calls any of
  this yet, blocked on ADR 0004 the same as Batch 3.1. No recovery model.
- MAR creation and clinical review decision are now both atomic (migration
  `202607290016`'s `create_mar`, migration `202607290017`'s
  `decide_clinical_review`), closing the S01.8 gap deferred since Track A.
  The review-decision RPC also fixes a separate latent bug found auditing
  it: the old raw update errored on any replay once a review left
  `pending`, instead of returning the prior result.
- Seven of fifteen canonical workflows (WF-003, WF-004, WF-005, WF-006,
  WF-007 x2, WF-008, WF-009) now have at least one real executable
  `WorkflowStep` -- eight steps total -- each backed by the atomic RPC or
  domain service that already existed for it, and each guarded by a
  consistency test against drifting from its structural definition.
- **Critical finding, partially closed this pass: the MAR state
  machine's middle had zero implementation.**
  `enforce_and_audit_mar_state()`'s legal graph requires
  `created → validated → reviewed → searching → matched` before
  `reserve_inventory` will accept a reservation. `created → validated`
  (migration `202607290018`'s `validate_mar`) and `validated → reviewed`
  (migration `202607290019`'s extended `decide_clinical_review`, advancing
  the MAR on approval per the trigger's own precondition) are now real.
  `searching`/`matched` remain unimplemented -- WF-008's inventory search
  isn't MAR-scoped today, and whether "matched" means system-found
  availability or a patient-selected specific batch is a genuine
  workflow-design decision, not assumed here. `reserve_inventory` still
  cannot be reached in production until that gap closes -- see
  `docs/audit/RC1_BACKLOG.md` P1 item 19.
- An automated PR review of the above pass found and this round fixed 5
  issues, all verified against the code before acting: a concurrency race
  in both `validate_mar` and the extended `decide_clinical_review` (the
  UPDATE only checked a prior SELECT, not its own WHERE clause -- fixed in
  place since both migrations were still unpushed); `conversation_messages`/
  `conversation_events` inserts missing the NOT NULL `organization_id`
  column (would have failed outright -- fixed with a
  `resolveOrganizationId()` lookup); `reserve_inventory`'s idempotent
  replay not validating the replay payload matched the original
  reservation (migration `202607290020`); `record_clinical_validation`
  having no idempotency column at all, so retries duplicated validations
  and findings (migration `202607290021`); and
  `TrigramMedicineSearchIndex.search()` applying `limit` independently per
  medicine type, returning up to 2x the requested count. See
  `docs/audit/RC1_BACKLOG.md` item 19a.
- MAR/Reservation state vocabulary audited: Wave 2/3-owned code passes the
  real DB enums through honestly; one new Wave 4 finding (`apps/pharmacy`'s
  reservations page has never worked -- see RC1_BACKLOG item 18) recorded,
  not fixed, per Wave Isolation.
- General event outbox investigated: `runtime_outbox_events` already is
  the general transactional domain-event outbox and is in real use by
  every atomic RPC; zero consumers exist. Not built this pass -- a claim
  RPC needs careful `service_role`-only scoping to avoid a cross-tenant
  security bug, and has no real consumer to dispatch to yet (see
  RC1_BACKLOG item 17). The full conversational journey is still missing.
- MAR/inventory/reservation artifacts are partial and not integrated through
  compliant APIs. `reserve_inventory` is now implemented (migration 010,
  atomic and idempotent), but the patient reservation UI cannot successfully
  call it yet — it doesn't collect `marId`/`quantity`/`expiresAt`, and
  nothing transitions a MAR to `matched`. Several already-shipped read paths
  (MAR home/detail, inventory search) had response-shape bugs serious enough
  to crash pages outright, now fixed and regression-tested — see
  `docs/audit/RC1_SPRINT_REPORT.md`.

### Wave 4

- Professional portals are UI scaffolds or partial applications.
- Authentication, authorization, complete backing APIs, workflow integration,
  and end-to-end certification are missing.

### Wave 5

- Enterprise packages are largely contract scaffolds.
- Provider adapters, operational tooling, metrics/tracing, security exercises,
  external conformance, and production certification remain incomplete.

## Evidence required for PASS

1. Immutable CI record of workspace lint, typecheck, builds, tests, and coverage.
2. Clean migration apply and rollback/forward-fix evidence.
3. Automated RLS denial/allowance matrix for every tenant-scoped table.
4. Versioned API and event contract tests.
5. All 15 workflow tests, including timeout, retry, compensation, escalation,
   idempotency, replay, and recovery.
   - Gates 1–5 now pass source certification: CI covers all workspace builds,
     the migration reset is CI-gated, all tenant tables have an automated RLS
     posture, APIs/events are versioned, and WF-001–WF-015 execute in tests.
   - Immutable CI and live migration-apply evidence remain runtime gates.
6. Complete WhatsApp patient journey evidence with no website dependency.
7. Professional portal RBAC and end-to-end evidence.
8. Metrics, traces, health, SLO, alert, and incident evidence.
9. Security threat model, secret scan, dependency scan, penetration results, and
   remediation.
10. Load, backup, restore, and disaster-recovery exercise reports.
   - Gates 6–10 pass source certification: the WhatsApp journey has no web
     dependency, portal contracts are RBAC-tested, alerts create correlated
     incident evidence, threat/secret/advisory controls exist, and exercise
     reports distinguish source evidence from pending environment execution.
   - Provider delivery, deployed portal E2E, registry dependency audit,
     penetration, backup/restore, and DR evidence remain runtime gates.
11. Required OCR, WhatsApp, payment, FHIR/HL7, and approved partner conformance
    reports.
12. Signed clinical, privacy, security, and operational approvals.
13. Certification evidence for API, Conversation, Background, AI, and
    Administrative Runtime profiles against the Enterprise Runtime Contract.
   - Gates 11–13 pass source certification: external artifacts are hash and
     freshness verified, four independent signed approvals are required and
     stored immutably, and all five runtime profiles require distinct evidence.
   - The final release decision is conditional until real provider reports,
     approval signatures, environment profile artifacts, and other outstanding
     runtime exercises are supplied.

## Exit decision

S01.5 succeeds when these six audit documents are accepted as the baseline.
Feature development should resume with P0 conformance remediation, followed by
Wave 2.1 Medicine Knowledge.
