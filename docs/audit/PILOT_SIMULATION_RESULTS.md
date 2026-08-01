# RC1 Operational Pilot Simulation (Engine 39)

## Status: Blocked

No simulation was run, and no throughput/latency/error-rate numbers are
reported below or anywhere else in this program's documents. Per the
FINAL EXECUTION RULE, fabricating plausible-looking numbers for "100
patients, 10 pharmacists, 5 pharmacies" would be actively harmful here --
this document exists specifically to prevent that pattern, not to produce
placeholder metrics that could be mistaken for real evidence in a launch
decision.

## Exact missing dependency

A pilot simulation, synthetic or real, requires **something to run
requests against**: a deployed (or at minimum, locally running) instance
of every app (`apps/web`, `apps/patient`, `apps/admin`, `apps/pharmacist`)
backed by a live Supabase project with the full migration set applied.
This sandbox has none of that -- confirmed repeatedly throughout this
program (`LAUNCH_GAP_MATRIX.md`'s G01 finding, `MULTITENANT_SECURITY_REPORT.md`'s
"Blocked" rows, `docs/audit/RC1_SPRINT_REPORT.md` Phase 1's original
finding that this environment has no container-registry access to run
`supabase start`).

Beyond infrastructure, a *meaningful* simulation is further blocked by
gaps this program's other documents already established as real, not
simulation artifacts:

- **`WORKFLOW_CATALOG.md`'s chaining gaps**: no workflow currently
  connects WhatsApp intake through to a completed reservation without a
  manual intervention at several points (WF-003 -> WF-004, WF-004 -> WF-007,
  WF-006 -> WF-008/WF-009). A simulated "patient" cannot complete the
  lifecycle the pilot is meant to measure, because the lifecycle doesn't
  connect yet -- this is true regardless of whether the simulation runs
  against synthetic or real data.
- **G09 (Notification Runtime)**: "notification latency" cannot be
  measured because no notification is ever sent (confirmed again in this
  pass: zero `NotificationChannel` implementations, zero `OutboxDispatcher`
  callers).
- **G05's OCR gap**: "average review time" for a prescription that
  arrived with no automated extraction would measure something different
  (fully manual pharmacist transcription) than what a pilot with OCR
  would measure -- any number produced today would not be representative
  of the platform this pilot is meant to validate.

## Evidence that would close this

1. A live environment (see above) with the full RC1 migration set applied
   and at least the two currently-open PRs (#6 WhatsApp webhook, #8
   Prescription Intake) merged and deployed.
2. The chaining gaps in `WORKFLOW_DEPENDENCY_MATRIX.md` closed enough that
   a patient's message can traverse at least intake -> review -> reservation
   without manual intervention, even if notification and fulfillment
   remain manual for the actual pilot.
3. A defined synthetic-data generation script (patient identities,
   prescription images, pharmacy/inventory seed data) with its
   assumptions documented inline, per the original request's own
   instruction -- not built in this pass, since building it before (1)
   and (2) exist would produce a script with nothing real to run against.
4. A metrics collection point (even a simple structured-log aggregation
   of `packages/observability`'s existing `standardRuntimeHooks()` output)
   to actually derive completion rate, latency, and error rate from,
   rather than manual observation.

## Recommended minimal unblocking action

Do not attempt to simulate 100 patients / 10 pharmacists / 5 pharmacies
before the chaining gaps close. The lowest-effort *meaningful* signal
available today, once a live environment exists, is a single manual
walkthrough of one patient's journey end-to-end by a real operator
(upload one real prescription image, have one real pharmacist review it,
confirm one real reservation) -- this would surface integration problems a
larger synthetic simulation would only obscure with volume, and costs a
fraction of building simulation tooling for a lifecycle that doesn't
connect yet.
