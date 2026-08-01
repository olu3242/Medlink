# Operational Governance (Engine 65)

Method: read every file in `docs/runbooks/` (8 files, 124 lines total)
plus `docs/adr/0004-production-operations-framework.md` and
`docs/release/rc1-ga/GA_DECISION.md`. Most items in this domain were
already assessed as OPEN by `GA_DECISION.md`; this document does not
re-litigate that verdict, it maps what exists in source against each
requested category precisely.

## Monitoring

**Source-present, deployment-unverified.** `packages/observability`
provides structured logging, correlation IDs, metrics, and tracing
primitives, wired into every route via `standardRuntimeHooks()`
(consolidated this session's earlier work from two independently-drifted
copies into one shared implementation). Health endpoints
(`/health/{startup,ready,live,details}`) are real and dependency-checked.
**Not evidenced**: dashboards, SLO definitions, or alert routing against
a live deployment -- `GA_DECISION.md` and every document in this
program that touches observability agree on this gap.

## Incident management

`docs/runbooks/dead-letter.md`, `dependency-outage.md`, `queue-backlog.md`,
`slo-breach.md` (7 lines each) define a *contract* -- trigger condition,
immediate action, escalation reference -- but are skeletal, not detailed
runbooks with verification steps, prerequisites, or rollback guidance
(the depth Batch 5's Engine 48 would eventually require). They read as
placeholders establishing the categories that need real content, not as
operational-ready documents a support engineer could follow today.

## Support procedures

`docs/runbooks/production-operations.md` (37 lines) and
`enterprise-service-operations.md` (23 lines) are the most substantial
files in this directory but remain contract-level (who owns what) rather
than procedural (how to actually do it). No patient- or pharmacist-facing
support process is documented anywhere in this repository.

## On-call readiness

**Not evidenced.** No on-call schedule, rotation, paging configuration,
or tooling reference exists in this repository. This is expected --
on-call is an organizational/staffing decision, not something a
repository can certify -- but it is listed here as explicitly Needs
Validation rather than silently assumed handled.

## Escalation paths

Two real, structural escalation paths exist and are load-bearing, not
placeholders: `docs/HANDOFF.md` (cross-boundary work between the two
named engineering owners, per ADR 0005's dual-AI protocol) and
`packages/agents`' `AgentEscalation` mechanism (a governed agent capability
blocks on human approval, PR #5). Neither is a *production incident*
escalation path (patient-safety issue, security incident, outage) --
those remain undocumented beyond the skeletal runbook trigger references
above.

## Change management

- **Code change control**: real and enforced -- `ci.yml`'s single `verify`
  job (`npm ci && npm run check && npm run build`) gates every PR and push
  to `main`; `architecture.test.ts` and the migration certification
  suite catch several classes of regression automatically (demonstrated
  live in this program: it caught a real violation in
  `PRESCRIPTION_INTAKE_CERTIFICATION.md`'s own development).
- **Database change control**: migrations are append-only, sequentially
  numbered, and certified by content assertion (never executed against a
  live database by this repository's own tooling -- the same limitation
  named throughout this program).
- **ADR governance**: real (`IMPLEMENTATION.md`'s Platform Freeze Gate,
  invoked and honored multiple times this session before touching frozen
  contracts) but undermined by the numbering collision
  `ADR_CONFORMANCE_REPORT.md` documents -- a governance *mechanism* that
  works, applied against a *registry* with an integrity gap.
- **Production deployment change control**: `GA_DECISION.md`'s "Production
  deployment/rollback: OPEN" stands unchanged; no PR in this program
  touches deployment tooling.

## Verdict

Operational governance is **source-adequate for engineering-controlled
change** (CI gates, ADR process, migration discipline) and **not yet
adequate for production incident response** (skeletal runbooks, no
on-call model, no patient/pharmacist support process, no verified
monitoring/alerting). This is consistent with, not contradictory to,
`GA_DECISION.md`'s existing findings -- this document adds the specific
line-count/content-depth evidence for the runbook gap that document
states more generally, and confirms nothing has changed on this front
during this session's engineering work (expected, since no PR in this
program targeted operations).
