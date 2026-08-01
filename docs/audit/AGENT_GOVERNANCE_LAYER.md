# Agent Governance Layer (AGL-1 .. AGL-5)

## Naming note

`docs/release/rc1-ga/RC2_EXECUTION_PLAN.md` and
`docs/release/rc2/RC2_EARLY_DEVELOPMENT_AUTHORIZATION.md` already reserve
"Engine 36-40" for a different, explicitly RC2/post-GA scope (Clinical
Intelligence, National Interoperability, Population Health, Healthcare
Intelligence, Autonomous Operations), and `GA_DECISION.md` states plainly
that "RC2/Engines 36-40 remain blocked" pending RC1 GA sign-off (currently
NO-GO). The agent-registry/context/planning/coordination/supervision
infrastructure described below is a *different* piece of work -- RC1-scoped
platform governance plumbing, not an RC2 clinical/ML capability -- so it is
named and numbered separately as the **Agent Governance Layer, phases
AGL-1 through AGL-5**, to avoid making the repository's own certified
roadmap self-contradictory. If the intent was instead to reassign "Engine
36-40" to this scope, `RC2_EXECUTION_PLAN.md` needs a deliberate amendment,
not a second, conflicting definition introduced silently by this doc.

## Architectural invariant

Every AGL phase enforces the same chain, and nothing in AGL-1..AGL-5 grants
an agent authority to skip a link in it:

```text
Named Agent
    -> Agent Capability Governance
    -> Policy
    -> RBAC + Tenant
    -> Canonical ARC / Workflow Runtime
    -> Idempotent Transaction
    -> Outbox / Evidence / Audit
```

Never: agent -> direct unrestricted database mutation.
Never: agent -> bypass canonical workflow.
Never: agent -> autonomous clinical decision. Pharmacist authority remains
mandatory for clinical substitution/alternative approval.

## AGL-1: Agent Registry & Capability Governance

Status: **PASS**

### What was built

- `packages/agents/src/registry.ts` -- the governed agent catalog
  (`governedAgentCatalog`), a typed `AgentIdentity`/`AgentCapability` model,
  and `validateGovernedAgentCatalog()`, a structural validator enforcing:
  - no duplicate agent ids or capability names,
  - every capability declares at least one allowed role,
  - a state-mutating capability names a real canonical RPC (`invokes`) and a
    read-only capability names none,
  - `invokes` can never be one of `humanExclusiveOperations`
    (`review_medicine_equivalence`, `decide_clinical_review`) -- enforced
    twice over: the `CanonicalOperation` union type refuses those names for
    any literal catalog entry at compile time, and the runtime validator
    catches the same violation for a catalog assembled dynamically (e.g.
    loaded from config), which the type system alone cannot cover,
  - no capability may set `clinicalDecision: true` without
    `requiresHumanApproval: true`.
- `packages/agents/src/policy.ts` -- `authorizeAgentCapability()`, the
  Policy layer of the invariant above. It only ever grants *autonomous*
  execution: an unregistered agent, a retired agent, an undeclared
  capability, a role outside `allowedRoles`, or (critically) any capability
  marked `requiresHumanApproval` all return `allowed: false`. RBAC and
  tenant scoping still apply again at the canonical RPC itself -- this is
  defense-in-depth, not a replacement for the existing per-RPC role checks
  and `RuntimeContext` tenant scoping.
- The catalog covers the eight agents `IMPLEMENTATION.md`'s "AI agent
  catalog and safety" section already names (Conversation, OCR, Medicine
  Match, Inventory, Clinical Review Assistant, Reservation Coordinator,
  Medication Education, Analytics), each capability grounded in an RPC or
  read path that already exists on `main` -- this registry declares which
  of those an agent may reach and under what role/approval gate; it
  introduces no new execution surface.

### Why the Clinical Review Assistant never decides anything

`flag_validation_findings` invokes `record_clinical_validation` (the same
RPC the existing clinical-validation route already calls) and is marked
`requiresHumanApproval: true`. It can surface duplicate-therapy/allergy/
polypharmacy findings; it can never call `decide_clinical_review` (approve/
reject) or `review_medicine_equivalence` (substitution approval) -- both are
in `humanExclusiveOperations` and therefore untypeable as any agent
capability's `invokes` target.

### Tests / certification evidence

- `packages/agents/src/registry.test.ts` -- 12 tests: the real catalog
  passes structural validation with zero violations; every capability's
  `clinicalDecision` is `false`; no capability's `invokes` is in
  `humanExclusiveOperations`; each of the seven validator rules is proven
  against a synthetic bad catalog (not just the real one happening to pass).
- `packages/agents/src/policy.test.ts` -- 7 tests: unregistered agent,
  retired agent, undeclared capability, role mismatch, human-approval-gated
  capability (denied even for an otherwise-permitted role), a valid
  autonomous grant, and the real catalog's default wiring.
- 100% statement/branch/function/line coverage on `packages/agents/src`.
- `npm run check` (lint + typecheck + `vitest run --coverage`): pass --
  478 tests passed, 8 skipped (up from 459/8 on the pre-AGL-1 baseline).

## AGL-2: Agent Context & Memory Governance

Status: **PASS**

### What was built

- `supabase/migrations/202607310001_agent_memory_governance.sql` --
  `agent_memory_entries`: tenant-scoped (`organization_id`), RLS-enabled
  working memory for a governed agent, keyed by `(organization_id,
  agent_id, subject_id, key)`. `subject_id` is `not null` specifically so
  the uniqueness constraint can't be silently defeated by Postgres treating
  multiple `NULL`s as distinct. A `CHECK` constraint requires `expires_at`
  whenever `memory_boundary = 'session'` -- an independent database-level
  safety net, not reliant on the calling code getting it right. Like
  `conversation_messages`/`conversation_events` (migration 202607290012),
  there is no `authenticated` write policy: an agent acts through the
  service role, never as a request-scoped authenticated session.
  Authenticated `platform_admin`/`tenant_admin` roles get read-only access
  for support and audit (`agent_memory_entries_admin_read`).
- `packages/agents/src/memory.ts` -- `AgentMemoryStore` port,
  `authorizeMemoryWrite()`, and the governed write path
  `writeAgentMemory()`. `authorizeMemoryWrite` looks the agent up in AGL-1's
  `governedAgentCatalog` (this is the "integrate" link between AGL-1 and
  AGL-2) and enforces its declared `memoryBoundary`: `"none"` can never
  acquire a row at all, `"session"` must carry an expiry, `"tenant-durable"`
  may omit one. `writeAgentMemory` is the only path that reaches a store --
  a denied decision never calls `store.write()`.
- `InMemoryAgentMemoryStore`, an in-memory `AgentMemoryStore` used by
  `memory.test.ts` and available for any future in-process caller/test; a
  Supabase-backed adapter is intentionally not built yet, for the same
  reason `packages/conversation`'s route is still blocked on ADR 0004 and
  `packages/whatsapp`'s webhook route doesn't exist yet (`docs/audit/
  ENGINE_STATUS_MATRIX.md`): no consuming route exists to own or exercise
  it, and adding one now would be unexercised code, not a governance gap.

### Tests / certification evidence

- `packages/agents/src/memory.test.ts` -- 9 tests: unregistered/retired
  agent denial, `"none"`-boundary denial (against the real `ocr` entry),
  session-without-expiry denial and session-with-expiry allowance (against
  the real `conversation` entry), tenant-durable allowance with no expiry
  (against the real `clinical-review-assistant` entry), `writeAgentMemory`
  never reaching the store on denial, and `InMemoryAgentMemoryStore`'s
  tenant/agent/subject scoping and overwrite-by-composite-key behavior.
- `packages/runtime/src/migration.test.ts` -- new `"agent memory governance
  migration"` block: table/RLS existence, the session-expiry `CHECK`, the
  `subject_id not null` + composite-uniqueness pairing, absence of any
  `authenticated` write policy, and presence of the admin-only read policy.
- `packages/runtime/src/rls-matrix.test.ts`'s tenant-table-discovery test
  auto-discovers `agent_memory_entries` (it scans every migration for
  `create table public.* (...)` containing `organization_id`) and confirms
  it both enables RLS and declares at least one policy -- no test file
  needed manual registration for this.
- `npm run check`: pass -- 494 tests passed, 8 skipped.

## AGL-3: Agent Planning & Deterministic Execution

Status: **PASS**

### What was built

- `packages/agents/src/planning.ts` -- `buildAgentPlan()`,
  `toWorkflowSteps()`, and `AgentPlanAuthorizationError`.
  `buildAgentPlan(workflowType, steps)` performs the one check available
  independent of any particular caller: every step's `(agentId,
  capabilityName)` pair must already be declared in AGL-1's
  `governedAgentCatalog`, so a plan can never reference a capability that
  was never registered. It deliberately cannot check role/tenant/human
  approval at this point -- those depend on who eventually runs the plan.
  `toWorkflowSteps(context, plan)` is where that second, per-caller check
  happens: it converts each `AgentPlanStep` into a real `WorkflowStep` from
  `@medlink/workflows` (a new, one-directional `agents -> workflows`
  package dependency; no cycle), whose `execute()` calls
  `authorizeAgentCapability(context, ...)` immediately before the step's own
  handler runs. A denial throws `AgentPlanAuthorizationError` instead of
  returning; `WorkflowService.run()` (already shipped, unmodified) propagates
  that exception rather than continuing to the next step, so a denied step
  halts the whole plan (fail-closed) instead of being silently skipped or
  the remaining steps running out of order.
- No new execution engine: an `AgentPlan` **is** a sequence of
  `WorkflowStep`s once authorized, run through the same `WorkflowService`
  Wave 3 already ships. This is the literal "integrate with the canonical
  ARC/workflow runtime, never build a second one" requirement -- planning
  adds a governance wrapper in front of the existing runtime, not a
  parallel one.

### Tests / certification evidence

- `packages/agents/src/planning.test.ts` -- 6 tests: a plan builds cleanly
  when every step is a real declared capability; an invented capability
  name and an entirely unregistered agent are both refused at build time
  with a precise violation message; an autonomous, permitted capability
  (`conversation.route_intent`) runs to completion through the real
  `WorkflowService`, including its context-patch return value landing in
  the instance; a `requiresHumanApproval` capability
  (`clinical-review-assistant.flag_validation_findings`) halts the plan via
  `AgentPlanAuthorizationError` with its handler never invoked, even for an
  otherwise-permitted `pharmacist` role; a role the capability doesn't
  permit halts the same way.
- `npm run check`: pass -- 500 tests passed, 8 skipped.

## AGL-4: Multi-Agent Coordination & Handoff

Status: **PASS**

### What was built

- `packages/agents/src/coordination.ts` -- `HandoffEvent`,
  `CoordinationLog`, `deriveHandoffs()`, `recordPlanHandoffs()`, and
  `coordinatedWorkflowInvoker()`.
  - `deriveHandoffs(plan)` walks an AGL-3 `AgentPlan` in step order and
    emits one `HandoffEvent` every time the acting agent changes
    (`fromAgentId: null` for the plan's entry step -- it isn't handed off
    from another agent inside the plan itself). Consecutive steps by the
    same agent produce no duplicate. Each event's `requiresHumanApproval` is
    read straight from AGL-1's registry, so AGL-5's escalation gate never
    has to re-derive it.
  - `recordPlanHandoffs()` writes the derived events to a `CoordinationLog`
    *before* the plan runs, so the trail is accurate even if AGL-3's
    `AgentPlanAuthorizationError` halts a later step -- the attempted
    handoff is still on record.
  - `coordinatedWorkflowInvoker()` wraps an existing `WorkflowInvoker` (the
    `@medlink/conversation` port `apps/web/lib/workflow-invoker.ts`'s
    already-shipped `WorkflowOrchestratorInvoker` implements -- the real
    connection between the Conversation Engine and the Workflow
    Orchestrator ADR 0003 draws) so that handing a canonical workflow off to
    it is itself a logged, governed handoff. This is the literal
    integration point: a coordination record in front of the existing
    invoker, not a second orchestration stack. `packages/agents` now
    depends on `@medlink/conversation` (a new, one-directional edge;
    conversation has no dependency back on agents, so no cycle).
- `InMemoryCoordinationLog`, used by the tests and available to any future
  in-process caller.

### Tests / certification evidence

- `packages/agents/src/coordination.test.ts` -- 6 tests: a single-agent
  plan derives exactly one entry handoff; a three-step, two-agent plan
  derives exactly two handoffs (no duplicate across the repeated
  `medicine-match` step); a handoff into
  `clinical-review-assistant.flag_validation_findings` is flagged
  `requiresHumanApproval: true`; `recordPlanHandoffs` writes events to the
  log in order and returns the same events it stored;
  `coordinatedWorkflowInvoker` records the handoff before delegating and
  returns the wrapped invoker's result unmodified.
- `npm run check`: pass -- 505 tests passed, 8 skipped.

## AGL-5: Human-AI Supervision, Escalation & Control

Status: **PASS**

### What was built

- `supabase/migrations/202607310002_agent_escalations.sql` --
  `agent_escalations` (tenant-scoped, RLS-enabled, `pending` /
  `approved` / `rejected`) plus two atomic RPCs mirroring
  `decide_clinical_review`'s (migration 202607290017) exact pattern,
  generalized from "clinical review" to "any governed agent capability a
  human must approve":
  - `raise_agent_escalation` -- idempotent on `(organization_id,
    idempotency_key)`; commits the escalation row and its runtime evidence
    (`agent_escalation.raised`) in one transaction.
  - `decide_agent_escalation` -- restricted to `pharmacist` (matching
    `decide_clinical_review`'s own restriction; the comment in the
    migration documents this is RC1 scope because every current
    `requiresHumanApproval` capability is clinical, and broadening it for a
    future non-clinical case needs a deliberate decision, not a silent
    widening); idempotent-replay-safe the same way -- a repeated call with
    the same decider/status/rationale on an already-decided escalation
    returns the existing row, anything else raises.
- `packages/agents/src/supervision.ts` -- `EscalationStore`,
  `InMemoryEscalationStore`, `PendingEscalationError`,
  `EscalationRejectedError`, and `toSupervisedWorkflowSteps()`, which
  supersedes AGL-3's `toWorkflowSteps` for any plan that may contain a
  `requiresHumanApproval` step. Instead of throwing a one-shot
  `AgentPlanAuthorizationError`, such a step now raises (or finds the
  existing, idempotent) durable `AgentEscalation` first and blocks strictly
  on its status: `pending` and `rejected` both halt the plan (the same
  fail-closed posture AGL-3 established), and the step's own handler runs
  **only** once a human has recorded `approved`. Steps that need no human
  approval keep AGL-3's exact autonomous-authorization path, unchanged.
- The resume path needs no new machinery: because the escalation's
  idempotency key is derived from the stable `(workflow instance id, step
  name, step index)` tuple, simply re-running the same plan with the same
  workflow idempotency key after a human decides the escalation finds the
  now-`approved` record and proceeds -- the same idempotent-retry
  discipline every other atomic use case in this repository already
  depends on, not a bespoke resume mechanism.

### Tests / certification evidence

- `packages/agents/src/supervision.test.ts` -- 7 tests: `raise()` is
  idempotent on a repeated key; `decide()` replays an identical redecision
  and rejects a conflicting one; a plan blocks on a pending escalation with
  the handler never invoked; re-running the same plan after the escalation
  is approved resumes and completes it, handler invoked exactly once; a
  rejected escalation halts permanently, still without running the
  handler; a step needing no human approval is unaffected (AGL-3's path
  still exercised end to end through `toSupervisedWorkflowSteps`).
- `packages/runtime/src/migration.test.ts` -- new `"agent escalations
  migration"` block: table/RLS/status-enum existence, `raise`'s idempotent
  creation, `decide`'s pharmacist-only restriction (matching
  `decide_clinical_review`), its idempotent-replay/conflict behavior, and
  that both RPCs commit runtime evidence atomically (`not.toContain("commit;")`).
- `packages/runtime/src/rls-matrix.test.ts` auto-discovers
  `agent_escalations` the same way it did `agent_memory_entries`.
- `npm run check`: pass -- **518 tests passed, 8 skipped** (up from 459/8
  on the pre-AGL-1 baseline). `packages/agents/src` coverage: 99.15%
  statements, 97.11% branches, 96.96% functions, 99.15% lines.
- `npm run build` (all 8 app workspaces): pass.
