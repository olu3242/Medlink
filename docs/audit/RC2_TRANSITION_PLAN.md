# RC2 Transition Plan (Planning Only)

**This document authorizes nothing. No branch, schema, dependency, API,
or code change results from it.** Per the governing instruction for this
batch, RC2 is not implemented here -- this is a prioritized backlog with
rationale, dependencies, and complexity, for the repository owner to
adopt, reorder, or reject.

## Relationship to existing RC2 planning artifacts

This repository already has two RC2 planning documents that this plan
does not replace or contradict:

- `docs/release/rc1-ga/RC2_EXECUTION_PLAN.md` -- Engines 36-40 (Clinical
  Intelligence, National Interoperability, Population Health, Healthcare
  Intelligence, Autonomous Operations), admission-gated on RC1 GA sign-off.
- `docs/release/rc2/RC2_EARLY_DEVELOPMENT_AUTHORIZATION.md` -- a narrow,
  already-granted exception authorizing isolated development on the
  `rc2-development` branch ahead of GA, explicitly not authorizing
  production promotion.

This document adds the specific feature-level backlog items the current
certification program was asked to plan for (EMR integration, payments,
courier orchestration, SMS/USSD channels, advanced analytics, geographic
expansion) and maps each onto that existing Engine 36-40 framework where
one already exists, or names it as new, unscoped work where it does not.
Nothing here changes the admission sequence, branch boundaries, or
authorization status those two documents already establish.

## Prioritized backlog

Ordered by dependency (items that unblock others come first), not by
business value alone -- a backlog reordering exercise is a product
decision this document informs but does not make.

### 1. SMS/USSD notification channels

- **Rationale**: Directly extends the G09 notification gap this RC1
  program already diagnosed six times across its documents
  (`LAUNCH_GAP_MATRIX.md`, `FINAL_GO_NO_GO.md`, `EXECUTIVE_RISK_REVIEW.md`).
  The pilot's minimum WhatsApp-only slice establishes the
  `NotificationChannel` port pattern; SMS/USSD are the next channels
  behind it, not a new architecture.
- **Dependencies**: The RC1 minimum G09 WhatsApp slice must exist first
  (`FINAL_GO_NO_GO.md` item 3) -- this is additive to that pattern, not
  independent of it.
- **Complexity**: Low-to-medium relative to the rest of this backlog. The
  `NotificationChannel` port and `OutboxDispatcher` already exist in
  source; a new channel implementation is bounded, similar-shaped work to
  what PR #6's WhatsApp adapter already demonstrated.

### 2. Payments

- **Rationale**: Not covered by the existing Engine 36-40 roadmap at all
  -- that roadmap is clinical/interoperability/analytics-focused, not
  transactional. Needed before any pilot expands beyond a pharmacy-
  covered or grant-funded pilot cohort.
- **Dependencies**: Reservation and fulfillment workflows (WF-009
  onward) need to be end-to-end before a payment step has anything real
  to attach to; also requires its own compliance scope (PCI or equivalent
  regional payment regulation) this codebase has not evaluated at all.
- **Complexity**: High. New external integration, new compliance
  surface, new failure-mode class (partial payment, refund, chargeback)
  this architecture has no existing pattern for -- closest analog is the
  reservation atomic-RPC pattern, but payment idempotency and reversal
  semantics are materially harder than inventory reservation.

### 3. Courier orchestration

- **Rationale**: WF-011 (Delivery) is currently structural-only per
  `WORKFLOW_CATALOG.md` -- this is building out an already-named but
  unimplemented canonical workflow, not new scope invention.
- **Dependencies**: Needs the reservation/pickup workflows proven at
  pilot scale first (their state machine is the upstream trigger for any
  delivery dispatch); needs at least one real courier-integration partner
  identified, which is a business/partnership decision outside this
  document's scope.
- **Complexity**: Medium-high. The workflow orchestration pattern
  (`WorkflowStep`/`WorkflowInstance`) already exists and generalizes;
  the courier-partner API integration itself is unknown complexity until
  a partner is selected.

### 4. EMR integration (maps to Engine 37, National Interoperability)

- **Rationale**: Already scoped in `RC2_EXECUTION_PLAN.md` as Engine 37
  with named mandatory safety boundaries (versioned conformance, consent,
  patient matching, tenant/jurisdiction isolation). This item is not new
  planning; it is a pointer to already-approved scope.
- **Dependencies**: RC2 admission itself (per
  `RC2_EARLY_DEVELOPMENT_AUTHORIZATION.md`, isolated development is
  authorized; production promotion is not, pending RC1 GA and RC2's own
  gates). FHIR/OpenHIE conformance evidence is an external dependency no
  engineering work in this repository can produce alone.
- **Complexity**: High, already characterized as such in the existing
  plan's testing-strategy section (contract, tenant/RLS, AI-safety,
  independent certification evidence all required).

### 5. Advanced analytics (maps to Engine 39, Healthcare Intelligence Platform)

- **Rationale**: Already scoped in `RC2_EXECUTION_PLAN.md` as Engine 39.
  This item, too, is a pointer to existing approved scope rather than new
  planning -- flagged here only to confirm it was considered, not omitted.
- **Dependencies**: Meaningful analytics requires real pilot data volume
  first; building this ahead of a completed pilot risks analyzing
  synthetic or near-empty data, a sequencing risk worth naming even
  though it is not a technical blocker.
- **Complexity**: Medium for the platform layer (governed metrics,
  lineage, tenant-safe aggregation are named requirements already);
  complexity scales with whatever specific analytics are requested,
  which is not yet specified anywhere in this repository.

### 6. Geographic expansion

- **Rationale**: The one item in this backlog that is primarily
  organizational/regulatory, not engineering. Named here because it was
  requested, not because this repository has any code-level readiness
  gap specific to it beyond what multi-tenancy already provides
  structurally.
- **Dependencies**: Jurisdiction-specific regulatory review (pharmacy
  licensure, data residency, consent law) per-region -- none of which is
  an engineering artifact this program can produce. Data-residency
  questions overlap directly with `DATA_GOVERNANCE.md`'s open
  cross-border residency flag.
- **Complexity**: Not meaningfully assessable from source code alone.
  The multi-tenant RLS architecture already supports adding
  organizations; the question is legal/regulatory readiness per new
  region, not schema capacity.

## What this backlog deliberately does not include

Per this program's standing "no scope expansion during certification"
constraint, this document does not propose new architecture, does not
create new ADRs, and does not estimate calendar timelines (effort without
a committed team size and RC1 pilot outcome is speculation this document
declines to fabricate). It also does not reorder or override
`RC2_EXECUTION_PLAN.md`'s Engine 36-40 sequencing -- items 4 and 5 above
are explicitly presented as pointers into that existing plan, not
competing proposals.

## Gate before any of this starts

Unchanged from `RC2_EARLY_DEVELOPMENT_AUTHORIZATION.md`: RC2 development
may proceed in isolation on the `rc2-development` branch today, but RC2
production promotion remains blocked until RC1 reaches its own GA (or at
minimum, per this program's narrower question, pilot) bar, and until
RC2's own gates pass independently. This backlog is input to that
already-gated process, not a bypass of it.
