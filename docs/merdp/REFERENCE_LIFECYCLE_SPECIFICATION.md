# Reference Lifecycle Specification (RLS)

This document uses “RLS” for reference lifecycle; PostgreSQL row-level security
is always written out to avoid ambiguity.

## Dataset release lifecycle

```text
discovered -> registered -> acquired -> verified -> extracted -> parsed
-> transformed -> normalized -> matched -> mastered -> validated
-> review_required -> certified -> published -> superseded -> archived
```

Exceptional states are `quarantined`, `rejected`, and `revoked`. Stages that do
not apply are recorded as explicitly skipped with policy evidence; they are not
silently omitted.

## Entity lifecycle

```text
draft -> imported -> validated -> normalized -> matched -> certified
-> published -> deprecated -> retired -> archived
```

A new version may re-enter validation without mutating the published prior
version. Revocation is available from certified or published states.

## Universal transition contract

Every transition defines source and target, preconditions, authorized human or
workload roles, command and idempotency key, transaction boundary, validation,
audit action, outbox event, evidence, postconditions, timeout/retry behavior,
rollback or compensation, and downstream impact.

## Authority matrix

| Transition class | Authorized actor | Required control |
| --- | --- | --- |
| Acquisition and deterministic processing | Named workload identity | Registered source/release and approved versions |
| Validation completion | Validation workload | All applicable rules executed and evidence retained |
| Non-clinical review | Assigned data steward | Segregation from rule author where policy requires |
| Clinical certification | Qualified clinical certifier | Evidence, hard gates, explicit approval |
| Publication | Publication workload | Valid certification and compatible contract |
| Revocation | Governance/clinical authority | Reason, impact analysis, compensating event |
| Archival/deletion | Retention workload | Approved schedule, legal-hold check, immutable audit |

AI agents may recommend or route; they are never authorized transition actors
for merge, clinical certification, publication waiver, revocation, or deletion.

## Rollback semantics

Published facts are not erased by rollback. The platform supersedes or revokes
versions, emits compensating events, rebuilds projections, and reconciles
consumers. Raw source evidence and decision history remain according to policy.

## Concurrency and replay

Transitions use expected entity/release version and reject stale commands.
Repeated idempotency keys return the original outcome. Replays create execution
evidence but not duplicate logical transitions or events.

## Lifecycle certification

Tests prove every legal transition, rejection of illegal and unauthorized
transitions, atomic state/event/audit behavior, concurrent command handling,
retry, revocation, unmerge interaction, projection compensation, retention
holds, and deterministic replay.
