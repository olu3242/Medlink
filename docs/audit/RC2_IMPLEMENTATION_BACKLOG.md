# RC2 Dependency-Ordered Implementation Backlog

Only one vertical slice may be active at a time. P2/P3 work cannot displace an
open P0/P1 item.

## Completed source checkpoint

### RC2-P0-001 - ML-CAP-008 Inventory / WF-008 Inventory Discovery

Why first: approved prescription and canonical medicine source paths exist;
search, reservation, fulfilment, notification and WhatsApp depend on accurate
sellable stock.

Deliver as one slice:

1. Restore the existing route/domain architecture gate without weakening it.
2. Finalize the additive inventory migration, constraints, immutable ledger,
   command privileges, RLS posture, expiry worker and forward recovery.
3. Finalize inventory domain/application/repository contracts.
4. Expose versioned pharmacy management and patient-safe FEFO availability
   APIs through `runApi`.
5. Deliver authenticated pharmacy inventory list/create/detail/update/stock
   history UI and actionable failures.
6. Add inventory events, runtime audit/telemetry, idempotency, optimistic
   concurrency and expired-hold recovery evidence.
7. Add migration, unit, API contract, authorization and workflow tests.
8. Run lint, typecheck, focused/full tests, coverage and affected builds.
9. Apply/run live migration and RLS/concurrency tests when infrastructure is
   available; otherwise retain `BLOCKED` certification.

Result: **IMPLEMENTED; RUNTIME VALIDATION PENDING**. Items 1-8 are delivered in
the Batch 2 source checkpoint. Item 9 remains blocked because the Docker-backed
Supabase runtime is unavailable and cannot be replaced with static evidence.

## Next vertical slices

| Order | Slice | Priority | Dependency / exit |
| ---: | --- | --- | --- |
| 2 | Batch 3: ML-CAP-009 / WF-005+WF-008 Nearby medicine discovery | P0 | Implemented inventory projection plus pilot-LGA coordinates; requires explicit authorization |
| 3 | Batch 3: ML-CAP-010 / WF-009 Reservation | P0 | Search selection, atomic lock, compatible patient/pharmacy APIs; requires explicit authorization |
| 4 | ML-CAP-003 Pharmacy onboarding/approval | P1 | Required participating pilot location and license lifecycle |
| 5 | ML-CAP-010 / WF-010 Pickup fulfilment | P1 | Confirmed reservation, lock consumption, history |
| 6 | ML-CAP-011 Notification delivery | P1 | Reservation/pickup events, consent and outbox |
| 7 | ML-CAP-011 WhatsApp conversation path | P0 | All domain APIs above executable channel-neutrally |
| 8 | ML-CAP-004 Pharmacist administration | P1 | Govern profile/license assignment beyond decision RPC |
| 9 | ML-CAP-012 Pilot administration | P1 | Approved operational queues, audit and support only |
| 10 | Full Golden Path certification | P0 | Provider, migration, RLS, browser/conversation and recovery evidence |

## Deferred backlog

Payment, adherence expansion, provider/hospital portal, FHIR/OpenHIE, HMO,
delivery fleet, marketplace, advanced analytics, new personas, autonomous
agents, MAOS/MAIF, MDL-ENG-024/025 and Engines 36-40 remain unscheduled until
the Constitution and ADR admission process authorizes them.

## Next-engine rule

The next dependency-ordered batch is **Batch 3 - Search, Matching &
Reservation**. Its prerequisite source checkpoint and live certification gap
are now explicitly recorded. Do not start it until the user provides the next
execution authorization.
