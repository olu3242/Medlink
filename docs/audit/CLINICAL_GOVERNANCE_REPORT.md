# Clinical Governance Report (Engine 63)

Governance framing of `docs/audit/CLINICAL_SAFETY_CERTIFICATION.md`'s
technical findings (Batch 4, Engine 37) -- that document remains the
evidentiary source; this document adds the policy/legal-review flags the
technical audit deliberately left out of scope, and restates findings in
governance terms (who is accountable, what a human reviewer must know).

## Pharmacist approval boundaries

**Certified, structurally enforced.** No code path -- automated, agent, or
otherwise -- can approve a clinical review or a medicine equivalence
substitution without a genuine, session-authenticated pharmacist actor.
This is enforced at three independent layers (type system, RPC-level
`auth.uid()`/role check, RLS), not a single point of failure. Governance
implication: a pharmacist's license and professional judgment remain the
sole basis for every clinical decision this platform records -- there is
no configuration flag, admin override, or agent capability that can
change this without a source-code change to the platform itself.

## Alternative recommendation workflow

**Certified for what exists; nothing automated exists to govern beyond
that.** Every equivalence recommendation is pharmacist-authored and
attributed (`reviewed_by`, `reviewed_at`, committed atomically). There is
no AI-generated alternative-recommendation feature in this codebase to
govern -- `CLINICAL_SAFETY_CERTIFICATION.md` item 2 confirms this
explicitly. **Policy flag**: if a future release introduces an
AI-suggested alternative (as opposed to the current AI-flagged-finding,
human-decided pattern), that feature will need its own governance review
before launch -- this document is not pre-approving that future
capability, only certifying that none exists today.

## Clinical audit trail

**Certified with one scoped gap.** `mar_audit_events`, `clinical_reviews`
(once decided), and every `governance_audit_events`-backed action are
immutable by database trigger. `clinical_findings` is not -- a finding row
could technically be altered or deleted post-creation with nothing in the
schema preventing it (`CLINICAL_SAFETY_CERTIFICATION.md` item 4).
**Recommendation, restated in governance terms**: until this is fixed, do
not represent to a pharmacy partner, regulator, or patient that every
clinical finding is tamper-evident -- the review *decision* is, the
underlying *finding* that informed it currently is not. This is a
concrete, scoped, one-migration fix, not a structural redesign.

## Decision traceability

**Certified.** Every clinical/access RPC records a real actor, a
correlation ID, and a structured event payload in the same transaction as
the business-state change. A regulator or auditor asking "who decided X,
when, and why" has a real, queryable, tamper-evident answer for every
decision type except the `clinical_findings` gap noted above.

## Human oversight

**Certified for what's built; the clarification loop is a real, named
gap.** `packages/agents`' escalation mechanism
(`toSupervisedWorkflowSteps`) blocks any agent-adjacent action pending
human approval, and no agent capability can bypass it. Separately, and
more urgently for day-one pilot operation: **the pharmacist
`needs_information` clarification round-trip has no implementation
anywhere in this codebase** (`CLINICAL_SAFETY_CERTIFICATION.md` item 5).
A pharmacist reviewing a real case today has only approve/reject as
real, working options.

## Assumptions requiring policy or legal review (not resolved by this
report -- flagged for the repository owner and clinical leadership)

1. **Licensure and jurisdiction.** This platform enforces "a pharmacist
   decided this" at the software layer; it does not verify pharmacist
   licensure, scope of practice, or jurisdictional authority to dispense
   or substitute a specific medication. That verification is assumed to
   happen outside this system (at pharmacy-partner onboarding, presumably)
   -- not evidenced by anything in this codebase, and outside what a
   source-code audit can certify.
2. **Consent and disclosure.** `packages/agents`' Clinical Review
   Assistant surfaces automated findings (duplicate therapy, allergy,
   polypharmacy) to a pharmacist. Whether a patient must be informed that
   an automated system flagged something for pharmacist attention -- and
   what language that disclosure requires -- is a policy/legal question
   this technical audit cannot answer.
3. **Record retention for clinical decisions.** Immutability is certified;
   *how long* a decision must be retained, and under what jurisdiction's
   rules, is a policy question -- see `DATA_GOVERNANCE.md`'s retention
   section, which names the same open question from the data side.
4. **The `needs_information` gap's clinical-safety implication.** Without
   a clarification path, a pharmacist facing an ambiguous case has two
   options: reject (safe, but may deny a legitimate patient need) or
   approve with reservations (unsafe if the reservation isn't captured
   anywhere). Recommend this be treated as a clinical-safety priority for
   the reasons above, not purely a UX gap -- flagged here for clinical
   leadership sign-off on whether reject-only is an acceptable interim
   posture for a controlled pilot with a small, briefed pharmacist cohort.

## Verdict

Clinical governance is **structurally sound and technically enforced**
for every decision path that exists today. The platform does not, and by
design cannot, let an automated system make or bypass a clinical
decision. The two real gaps (`clinical_findings` immutability,
`needs_information` clarification) are both scoped and named, not vague
-- and both were already surfaced by the underlying technical audit; this
report's contribution is separating what needs an engineering fix
(`clinical_findings`) from what needs a clinical/product decision
(`needs_information`'s interim posture) from what needs a policy/legal
review this document cannot itself resolve (licensure verification,
consent/disclosure, jurisdiction-specific retention).
