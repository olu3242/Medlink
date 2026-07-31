# ADR 0004: Production Operations Framework

- Status: Accepted
- Date: 2026-07-30

## Context

RC1 needs deterministic deployment, stabilization, operational procedure,
support, and continuity controls. These controls must not duplicate runtime,
workflow, identity, observability, incident, or certification ownership.

## Decision

Engines 16–20 are domain contracts and fail-closed evaluators placed with their
existing owners:

- Certification owns deployment admission, rollback evidence, continuity
  evaluation, and the aggregate operational gate.
- Runtime owns hypercare signals and support ticket/SLA state.
- Governance owns versioned runbooks and advisory AI lookup.

Operational dashboards are deterministic projections from evidence-bearing
records. The engines do not execute providers, privileged actions, deployments,
or recovery procedures. Adapters and authorized operators perform those actions.

## Consequences

- Missing, malformed, expired, or failed mandatory evidence blocks release
  completion.
- AI can locate and summarize approved runbooks but cannot authorize or execute
  privileged procedures.
- Business-continuity simulations only certify supplied real exercise evidence;
  tests use synthetic fixtures and are not production certification evidence.
- GA and Wave 2.5 remain blocked until the established external and human
  certification gates pass.
