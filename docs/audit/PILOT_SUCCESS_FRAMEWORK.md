# Pilot Success Framework (Engine 68)

Defines what "the pilot worked" would mean, in measurable terms, once the
four `FINAL_GO_NO_GO.md` closable items are closed and a controlled pilot
actually runs. Nothing in this document is a claim that measurement is
happening today -- no pilot has started, no live environment exists yet.
This is the measurement plan the repository owner should adopt at pilot
launch, built from mechanisms this codebase already has (audit events,
`WorkflowInstance` status, `OutboxDispatcher` delivery state), not new
instrumentation.

## Why these metrics, not others

Each metric below is chosen because the underlying data already exists in
the schema (once the workflow chaining gap is closed) -- this is a
measurement plan against real columns and real state transitions, not a
wishlist requiring new tracking infrastructure.

## Metrics

| Metric | Target (controlled pilot, small cohort) | Measurement method | Data source |
| --- | --- | --- | --- |
| Prescription completion rate (upload -> pharmacist decision, no manual intervention beyond pharmacist review itself) | >= 80% | `WorkflowInstance` status = completed / total started, for WF-003 | `workflow_instances` table, once WF-003 exists as a queryable instance (currently structural only per `WORKFLOW_CATALOG.md`) |
| Pharmacist response time (upload received -> decision recorded) | Median < 24h for a controlled pilot (not an emergency-care SLA) | `reviewed_at - created_at` on `clinical_reviews` | Existing table, existing timestamps -- no new instrumentation needed |
| Reservation success rate (reservation requested -> confirmed, no inventory conflict) | >= 95% | Reservation RPC outcome (`confirmed` vs conflict-rejected) / total attempts | Existing reservation RPC return codes |
| Notification delivery success | >= 95% once the minimum G09 WhatsApp slice exists | `OutboxDispatcher` delivered vs failed/dead-lettered | `OutboxDispatcher`'s existing retry/dead-letter states (currently untested and uncalled per `FAILURE_TEST_MATRIX.md` -- this metric is not measurable until that gap closes) |
| Platform uptime | No formal SLA for a controlled pilot; track health endpoint availability as a leading indicator | `/health/{live,ready}` polling | Existing health endpoints, external polling required (not self-reported) |
| Workflow failure rate (instance enters a terminal failure state, not just "slow") | < 5% | `WorkflowInstance` failed-status count / total | Same source as completion rate |
| User satisfaction (pharmacist and patient, where collected) | No numeric target -- qualitative, structured debrief after each pilot week | Not automated; requires a manual survey/interview process | No existing mechanism in this codebase; must be built as a pilot-operations process, not a code feature |

## What is NOT measurable today, and why

- **Prescription completion rate and reservation success rate** require the
  WF-003 chaining gap (`WORKFLOW_DEPENDENCY_MATRIX.md`) to be closed first
  -- today no workflow instance can be created end-to-end from a real
  WhatsApp message, so there is nothing to measure yet.
- **Notification delivery success** requires the minimum G09 slice
  (`FINAL_GO_NO_GO.md` item 3) -- `OutboxDispatcher` currently has zero
  live callers.
- **User satisfaction** has no code-level mechanism at all in this
  repository and is out of scope for this program to build (an
  operational process, not an engineering artifact).

## Measurement cadence

Recommend daily automated rollups (a query against existing tables, not
new tooling) during the first two pilot weeks, weekly thereafter --
matching `CONTINUOUS_IMPROVEMENT_FRAMEWORK.md`'s recommendation that risk
and readiness reviews be diffed against a prior baseline rather than
produced from scratch each time.

## Relationship to the four `FINAL_GO_NO_GO.md` closable items

This framework is only executable once the pilot itself is executable --
it depends on, and does not substitute for, closing the live-environment,
chaining-gap, minimum-G09, and credential-rotation items already named.
Building this measurement plan now (rather than after pilot launch) means
the pilot's first day already has a defined success bar instead of one
invented retroactively.

## Not built in this pass

No dashboard, query, or automation was added. This document is the
measurement plan; implementing it is pilot-operations work, correctly
out of this certification program's scope.
