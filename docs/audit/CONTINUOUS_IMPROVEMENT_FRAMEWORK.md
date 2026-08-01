# Continuous Improvement Framework (Engine 67)

Forward-looking process design, grounded in mechanisms this repository
already has (CI gates, ADR governance, migration certification,
`docs/audit/` evidence discipline) rather than inventing new tooling.
Everything below is a proposal for the repository owner to adopt, adjust,
or reject -- not a claim that it is already in effect.

## Release cadence

Recommend two tracks, matching the RC1/RC2 split this repository's own
documents (`RC2_EXECUTION_PLAN.md`) already establish:

- **RC1 patch track**: fixes and evidence-closing work only (e.g. the
  four items `FINAL_GO_NO_GO.md` names) -- no new capability, merged as
  soon as its own certification passes, no fixed cadence.
- **RC2 feature track**: anything expanding scope beyond the approved MVP
  Constitution -- batched, ADR-gated, and explicitly not started until
  RC1 reaches the GA (or at minimum, pilot) bar this program's documents
  define.

## Change approval

Already real, not proposed: every change in this session went through
`npm run check`/`npm run build` (CI-enforced), and every frozen-platform
change went through an ADR first (ADR 0004's acceptance this session
before any webhook code was written is the concrete example). Recommend
formalizing the existing informal pattern into an explicit checklist a
PR description must satisfy:

1. Does this touch a frozen-platform contract (`packages/runtime`,
   `docs/ENTERPRISE_RUNTIME_CONTRACT.md`, an accepted ADR)? If yes, an
   ADR must exist and be accepted first.
2. Does this add a new tenant table? If yes, `rls-matrix.test.ts` must
   discover it automatically (no manual test registration needed --
   verified this session, twice, for `agent_memory_entries`/
   `agent_escalations` and implicitly for every table since).
3. Does this touch an existing atomic RPC? If yes, does the change
   preserve backward compatibility for every existing caller (PR #8's
   `create_prescription_record` extension is the worked example: drop
   the exact old signature, add trailing `default null` parameters, zero
   changes needed to the one existing caller)?

## Regression testing

The mechanism already exists and already caught a real regression this
session (`architecture.test.ts` against `PRESCRIPTION_INTAKE_CERTIFICATION.md`'s
first draft). Recommend no new tooling, only discipline: every future PR
runs the full `npm run check` against a tree that includes whatever else
is currently open (this program's own `MERGE_READINESS_REPORT.md`
methodology -- a local integration merge before relying on GitHub's
per-PR CI alone), since GitHub CI only proves a PR is compatible with
`main`, not with sibling open PRs.

## Certification updates

`docs/audit/`'s pattern -- date-stamped, evidence-cited, explicitly
distinguishing "Certified"/"Partial"/"Blocked"/"Needs Validation" -- is
sound and should continue unchanged. The one process gap this program's
own `ENGINEERING_GOVERNANCE.md` names: no index distinguishes current
from superseded documents. Recommend a lightweight
`docs/audit/README.md` (a single table: document, date, status,
superseded-by-if-any) maintained as part of any PR that adds a new
`docs/audit/*.md` file -- cheap to maintain, meaningfully reduces the
"which document is authoritative" problem this program itself had to
solve by cross-referencing dates and PR numbers.

## Documentation maintenance

Recommend the same "flag stale claims rather than silently trust them"
discipline this program applied to `DEPLOYMENT_CERTIFICATION.md` and
`DEPENDENCY_RISK_REGISTER.md` (both found to contain claims that didn't
match current `main`) become a standing practice: any certification
document older than one release cycle should be re-verified, not
re-cited, before being used as evidence in a new decision.

## Risk reviews

`RC1_PILOT_READINESS.md`'s risk register (Critical/High/Medium/Low, each
with cited evidence) is the template. Recommend it be re-run (not
rewritten from scratch -- diffed against the prior version) at each
release-candidate boundary, so risk trend (closing vs. accumulating) is
visible over time, not just a snapshot.

## Evaluating RC2 work without destabilizing RC1

Three concrete guards, all already partially in place:

1. **`IMPLEMENTATION.md`'s Platform Freeze Gate** already blocks
   frozen-contract changes without an ADR -- the primary mechanism
   preventing RC2 work from silently altering RC1 foundations.
2. **`GA_DECISION.md`'s explicit statement** that "RC2/Engines 36-40
   remain blocked" pending RC1 GA sign-off is a real, standing guard --
   this session respected it by building the equivalent work (Agent
   Governance Layer) under a distinct name (AGL-1..5) rather than
   colliding with the reserved numbering, exactly the kind of
   non-destabilizing evaluation this section asks for.
3. **A recommended addition, not yet in place**: RC2 branches should be
   required to pass the same `MERGE_READINESS_REPORT.md`-style
   integration check against the current RC1 baseline before merging --
   not just against `main` at the moment the RC2 branch was cut, since
   RC1 patches may land after an RC2 branch starts.

## Not built in this pass

This document is a framework proposal, not tooling. No CI configuration,
script, or automation was added to enforce anything above -- that would
be new capability, out of this program's "certify, don't build" scope.
