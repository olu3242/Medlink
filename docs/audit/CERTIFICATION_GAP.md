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
| Workflow behavior | Fail | Canonical end-to-end workflow suites are absent |
| CDA conformance | Fail | Conversation Engine domain/application boundaries and schema exist (`packages/conversation`, migration `202607290012`); WhatsApp channel-adapter transport slice exists (`packages/whatsapp`, migration `202607290013`); route wiring is blocked on an ADR for webhook identity in `RuntimeContext` (see RC1_BACKLOG item 15), and Workflow Orchestrator integration is still missing |
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
  to. **Route wiring is blocked, not just undone**: `packages/runtime`'s
  `runtimeContextSchema` requires a non-optional `userId`, which an
  unauthenticated webhook never has, so no route can call `createRuntime()`
  for it today without either modifying frozen platform code without an
  ADR or hand-rolling a non-conformant pipeline. See
  `docs/audit/RC1_BACKLOG.md` P1 item 15 for the full finding — this needs
  an accepted ADR, not another wiring pass.
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
- MAR creation is now atomic (migration `202607290016`'s `create_mar`
  commits the MAR row and its runtime evidence together in one
  transaction), closing an S01.8 gap deferred since Track A. Clinical
  review decision remains non-atomic, with a separate latent replay bug,
  not fixed this pass.
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
6. Complete WhatsApp patient journey evidence with no website dependency.
7. Professional portal RBAC and end-to-end evidence.
8. Metrics, traces, health, SLO, alert, and incident evidence.
9. Security threat model, secret scan, dependency scan, penetration results, and
   remediation.
10. Load, backup, restore, and disaster-recovery exercise reports.
11. Required OCR, WhatsApp, payment, FHIR/HL7, and approved partner conformance
    reports.
12. Signed clinical, privacy, security, and operational approvals.
13. Certification evidence for API, Conversation, Background, AI, and
    Administrative Runtime profiles against the Enterprise Runtime Contract.

## Exit decision

S01.5 succeeds when these six audit documents are accepted as the baseline.
Feature development should resume with P0 conformance remediation, followed by
Wave 2.1 Medicine Knowledge.
