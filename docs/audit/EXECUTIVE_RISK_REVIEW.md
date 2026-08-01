# Executive Risk Review (Engine 69)

Consolidation of every open risk, blocked item, and deferred decision
surfaced across this session's certification program, organized by risk
category rather than by document of origin. No new risk analysis was
performed -- this is a synthesis pass, cross-referenced against
`SECURITY_GOVERNANCE_REPORT.md`, `RC1_PILOT_READINESS.md`'s risk
register, `FINAL_GO_NO_GO.md`, `CLINICAL_GOVERNANCE_REPORT.md`,
`OPERATIONAL_GOVERNANCE.md`, and `DATA_GOVERNANCE.md`. Severity
definitions match `SECURITY_GOVERNANCE_REPORT.md`'s Critical/High/
Medium/Low scale, applied here across all risk categories, not only
security.

## Engineering risk

| Severity | Risk | Status | Owner action |
| --- | --- | --- | --- |
| Critical | No canonical workflow completes end-to-end without manual intervention at 3+ points | Blocked on live environment + wiring | Close WhatsApp -> WF-003 chaining gap (`FINAL_GO_NO_GO.md` item 2) |
| Critical | Zero live multi-tenant isolation proof; zero live inventory-concurrency proof | Blocked on one missing dependency (live Supabase test environment) | Provision environment, run the two named test suites (`MULTITENANT_SECURITY_REPORT.md`, `FAILURE_TEST_MATRIX.md`) |
| High | `runApi`/`packages/api` duplicate the same runtime lifecycle independently | Known, tracked (`RC1_BACKLOG.md` item 1) | Consolidate under an ADR; not urgent, but a standing drift risk each time one copy changes and the other doesn't |
| High | `clinical_findings` has no immutability trigger, unlike every comparable audit table | Diagnosed, not fixed | One migration, same pattern used 20+ times elsewhere -- lowest-effort High-severity item in this entire review |
| Medium | ADR 0004 and 0005 are each double-claimed by two unrelated documents | Diagnosed this batch (`ADR_CONFORMANCE_REPORT.md`), not fixed | Renumber the two pre-existing conflicting ADRs to 0008/0009 in a dedicated follow-up PR |
| Medium | `OutboxDispatcher` has zero tests and zero live callers | Known (`FAILURE_TEST_MATRIX.md`) | Add retry/dead-letter unit tests now; wire a real caller when the G09 slice is built |
| Low | `packages/reservations` and parts of `packages/notifications` are orphaned/unused by any route | Diagnosed (`ENGINEERING_GOVERNANCE.md`) | Decide keep-and-wire vs. remove; no urgency |

## Operational risk

| Severity | Risk | Status | Owner action |
| --- | --- | --- | --- |
| Critical | Zero outbound patient notification of any kind (G09 fully unbuilt) | Blocked on scope decision + implementation | Build the minimum WhatsApp-only slice named in `FINAL_GO_NO_GO.md` item 3 |
| High | Runbooks are skeletal (8 files, 124 lines total) -- contracts, not procedures | Diagnosed (`OPERATIONAL_GOVERNANCE.md`) | Needs dedicated operational-readiness work (this program's Batch 5 territory), not closable by more certification documents |
| High | No verified monitoring dashboards, SLOs, or alert routing against a live deployment | Source-present, deployment-unverified | Requires an actual deployed environment to verify; not a code gap |
| Medium | No on-call schedule, rotation, or paging configuration | Not evidenced -- organizational, not engineering | Staffing/process decision, outside repository scope |
| Medium | No production-incident escalation path (patient-safety issue, security incident, outage) distinct from the existing cross-team handoff mechanism | Diagnosed (`OPERATIONAL_GOVERNANCE.md`) | Needs to be authored; not present anywhere today |
| Low | Backup/DR execution has zero evidence (schema reconstruction is proven; managed backup, PITR, regional failover are not) | Unchanged from `DR_CERTIFICATION.md`, out of this program's touched scope | Requires live infrastructure and a scheduled DR exercise -- GA-track, not pilot-blocking per `FINAL_GO_NO_GO.md` |

## Organizational / policy risk

| Severity | Risk | Status | Owner action |
| --- | --- | --- | --- |
| High | Pharmacist licensure/jurisdiction verification is assumed to happen outside this system; not evidenced anywhere in it | Flagged, not resolved (`CLINICAL_GOVERNANCE_REPORT.md`) | Confirm this happens at pharmacy-partner onboarding; outside what a source-code audit can certify |
| High | The `needs_information` clarification round-trip does not exist; pharmacists have only approve/reject | Real, named gap | Clinical leadership sign-off needed on whether reject-only is acceptable for a small, briefed pilot cohort, or whether this must be built first |
| Medium | No policy exists for prescription-image retention or deletion authority | New finding this batch (`DATA_GOVERNANCE.md`) | Policy decision needed before any image is deleted; current no-delete RLS posture is safe by default but not indefinitely sustainable |
| Medium | No data-subject deletion request mechanism exists anywhere in this codebase | Flagged, not resolved | Legal/jurisdiction-dependent policy question, prerequisite to any engineering work |
| Medium | Patient consent/disclosure language for AI-flagged clinical findings is undefined | Flagged (`CLINICAL_GOVERNANCE_REPORT.md`) | Policy/legal question, not answerable by this technical program |
| Low | Two historical leaked credentials (Supabase anon-key JWT, DB password), confirmed confined to an unmerged commit | Confirmed, not yet rotated | Rotate regardless of branch disposition -- cheap, should not wait on any other item |

## External dependency risk (not closable by engineering work in this repository)

- Independent penetration testing, provider (Supabase/WhatsApp) conformance
  attestations, and human sign-offs -- all named in `GA_DECISION.md`,
  unchanged, correctly out of scope for a pilot decision.
- Live infrastructure execution (the single missing dependency behind
  most Critical/High engineering and security risks above) -- one
  provisioning action closes a disproportionate number of items at once,
  the same finding `FINAL_GO_NO_GO.md` and `SECURITY_GOVERNANCE_REPORT.md`
  both independently arrive at.

## Deferred MVP items (explicitly not risks -- scoped out by design)

Per `docs/release-scope.md`'s Wave 4/5 sequencing and `FINAL_GO_NO_GO.md`'s
"what does NOT need to happen before a pilot" section: OCR, full G09
(email/SMS, all six notification types), and GA-specific items (managed
backup/DR exercises, independent pen test, provider conformance). Listed
here only to distinguish them from real open risk -- they are intentional
scope boundaries, not gaps.

## Cross-cutting observation

The single highest-leverage action across this entire review is
**provisioning one live Supabase test environment** -- it is the named
blocking dependency for both Critical engineering/security risks, and is
independent of every organizational/policy risk (which require human
decisions, not infrastructure). No amount of further certification
documentation closes any Critical item in this review; only that one
infrastructure action, plus the wiring and slice-building work
`FINAL_GO_NO_GO.md` already scoped, does.

## Verdict

Two Critical risks (both engineering, both closable by the same live
environment), one Critical operational risk (G09, closable by a scoped
minimum slice), and a well-bounded set of High/Medium items -- most
diagnosed with a named fix, a few genuinely requiring human/policy
decisions this document correctly does not attempt to make. No risk in
this review is newly discovered beyond the two batch-7-specific findings
(ADR numbering collision, prescription-image retention policy gap);
everything else is consolidation of prior, already-cited evidence into
one risk-category view for executive decision-making.
