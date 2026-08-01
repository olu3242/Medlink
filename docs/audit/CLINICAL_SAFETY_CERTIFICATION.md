# RC1 Clinical Safety Certification (Engine 37)

Method: static code/schema audit against the running test suite, not live
execution -- this is a category of evidence the sandbox limitation
throughout this program's other documents does not apply to, since
clinical safety controls here are structural (type system, database
constraints, RLS, triggers) rather than behavioral-under-load. Where a
control's *correctness under concurrent/adversarial use* would need live
proof, that's flagged separately and cross-referenced to
`FAILURE_TEST_MATRIX.md`.

## 1. No AI bypasses pharmacist review

**Certified.** `packages/agents/src/registry.ts`'s `governedAgentCatalog`
(PR #5) is the closed, typed set of every governed agent capability in
this codebase. Two enforcement layers, not one:

- **Type-level**: `humanExclusiveOperations` (`review_medicine_equivalence`,
  `decide_clinical_review`) is a closed union; `CanonicalOperation`
  (the type every capability's `invokes` field must satisfy) does not
  include either value. An agent capability naming one of these RPCs as
  its `invokes` target fails to typecheck -- not a convention, a compiler
  error.
- **Runtime**: `validateGovernedAgentCatalog()` re-checks the same
  invariant for a catalog assembled dynamically (a future config-driven
  catalog the type system couldn't see at compile time), and
  `packages/agents/src/registry.test.ts` proves the check actually fires
  against a synthetic violation, not just that the real catalog happens
  to pass.
- The only clinical-adjacent agent capability, Clinical Review Assistant's
  `flag_validation_findings`, is `requiresHumanApproval: true` and its
  `invokes` target is `record_clinical_validation` (advisory findings),
  never `decide_clinical_review` (the decision itself).
- `packages/agents/src/supervision.ts`'s `toSupervisedWorkflowSteps()`
  additionally halts any plan step marked `requiresHumanApproval` until a
  real `AgentEscalation` reaches `approved` -- the handler never runs
  before that, proven by `supervision.test.ts`'s "blocks a plan on a
  pending escalation without running the step's handler."

No agent capability in this codebase can call a clinical decision RPC. No
production route invokes any agent capability yet either (confirmed in
`WORKFLOW_CATALOG.md`) -- so today this is a governance layer with nothing
yet routed through it to bypass, which is itself the safest possible
state, not a gap.

## 2. Alternative recommendations are attributable

**Certified for the pharmacist-authored path; automated-alternative path
does not exist yet.** `review_medicine_equivalence` (migration
`202607290009`) requires a genuine `auth.uid()`-matched pharmacist actor
(`has_organization_role(..., array['pharmacist'])`), and its
`tenant_equivalence_reviews` row records `reviewed_by`/`reviewed_at`
alongside the recommendation, committed atomically with
`record_runtime_evidence`. `packages/medicine/src/equivalency.ts`'s
`PharmacistEquivalencyService` is the only caller. There is no automated
alternative-recommendation generator anywhere in this codebase for this
report to certify the attribution of -- every equivalence review in the
system today has a named, authenticated pharmacist attached to it by
construction, not by convention.

## 3. Every decision has a responsible actor

**Certified by construction, not just convention.** Every clinical/
access-governing RPC audited in this repository opens with:

```sql
if auth.uid() is null or target_actor_id is distinct from auth.uid() then
  raise exception 'Authenticated actor mismatch';
end if;
```

verified present in `create_mar`, `validate_mar`, `decide_clinical_review`,
`reserve_inventory`, `create_prescription_record`, `record_clinical_validation`,
`review_medicine_equivalence`, and `raise_agent_escalation`/
`decide_agent_escalation` (`packages/runtime/src/migration.test.ts`
asserts the RBAC re-enforcement pattern on each). A decision cannot be
recorded without a real, session-authenticated actor whose identity
matches the row being written. The one documented exception --
PR #6's WhatsApp Conversation Runtime system identity -- is explicitly
**barred** from calling any of these RPCs (ADR 0004's "Refinement
discovered during implementation": a service-role connection can never
satisfy `auth.uid()`), so the exception cannot be used to attribute a
clinical decision to a non-human actor.

## 4. Prescription history is immutable

**Certified for the audit trail; correctly *not* absolute for the mutable
state row itself.** Two distinct things, both verified:

- **The record of what happened is append-only.** `mar_audit_events`
  (`mar_audit_events_append_only` trigger, migration `202607270003`),
  `conversation_events`, `governance_audit_events`, and every other
  `runtime_evidence_records`-adjacent table have a `before update or
  delete` trigger raising on any mutation attempt --
  `prevent_enterprise_event_mutation()`/`prevent_append_only_event_mutation()`,
  verified across 20+ tables in this migration set.
- **A finalized clinical review specifically cannot be changed.**
  `clinical_reviews_final_guard` (migration `202607270003`): `if
  old.decision <> 'pending' then raise exception 'A finalized clinical
  review is immutable';` -- an update is only permitted while the review
  is still `pending`; once decided, the row is frozen. This is more
  precise than a blanket append-only guard and is the correct semantics
  for a row that legitimately needs one mutation (pending -> decided).
- **`prescriptions` itself is correctly mutable** (`status`,
  `validated_by`, `validated_at` change as it moves through its
  lifecycle) -- immutability applies to the *audit trail of what
  happened*, not to a state machine's current-state row, which is the
  right design, not a gap.
- **Gap found in this pass, not previously documented**: `clinical_findings`
  (migration `202607270002`) has **no append-only or immutability trigger
  at all** -- unlike `mar_audit_events` and `clinical_reviews`, a clinical
  finding row could be updated or deleted after creation with nothing in
  the schema preventing it. `record_clinical_validation`'s idempotency
  guard (this session's Codex-review fix) prevents *duplicate inserts* on
  retry, but that is a different property from *preventing mutation of an
  existing row*. Recommended action: add an append-only trigger to
  `clinical_findings` matching the pattern already used everywhere else in
  this schema, before this is relied on as clinically immutable.

## 5. Clarification requests preserve context

**Not certified -- could not find the mechanism.** `WORKFLOW_CERTIFICATION.md`'s
pharmacist-review section already flagged this: no route or test in this
repository exercises a `needs_information` clarification transition, and
this pass found no code path that captures/replays conversation context
back to a patient when one occurs. This is a real gap, not a documentation
oversight -- recommend scoping a "clarification round-trip" as its own
small, well-defined piece of follow-up work (likely touching WF-007's
`pharmacist_review` step and `ConversationEngine`'s handoff-resolution
path) rather than assuming it's covered by existing handoff machinery,
which was built for a different purpose (low-confidence intent, not a
mid-review clarification request).

## 6. Clinical notes are auditable

**Certified with the same `clinical_findings` caveat as item 4.**
`clinical_findings`/`clinical_validations` are committed atomically with
`record_runtime_evidence` (verified: `record_clinical_validation`'s
`record_runtime_evidence(` call count in `migration.test.ts`), so their
*creation* is fully audited (who, when, correlation ID, event payload).
Whether a finding, once created, can be silently altered afterward is the
same open question item 4 raises -- audited creation is certified,
audited *immutability* after creation is not, for this one table
specifically.

## Summary

| Control | Status |
| --- | --- |
| No AI bypasses pharmacist review | Certified |
| Alternative recommendations attributable | Certified (no automated path exists to certify beyond) |
| Every decision has a responsible actor | Certified |
| Prescription/decision history immutable | Certified, with one real gap: `clinical_findings` has no mutation guard |
| Clarification requests preserve context | **Not certified -- mechanism not found** |
| Clinical notes auditable | Certified for creation; immutability shares item 4's gap |

Two concrete, scoped action items came out of this audit, not generic
recommendations: (1) add an append-only trigger to `clinical_findings`;
(2) design and build the clarification/`needs_information` round-trip,
currently entirely absent.
