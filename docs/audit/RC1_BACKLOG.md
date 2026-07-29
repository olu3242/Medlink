# RC1 Conformance Backlog

Only work required by Waves 1–5 is listed. Priorities are certification order,
not authorization to implement multiple batches at once.

## P0 — Before Wave 2.1

1. **S01.6 Canonical API pipeline — source gate complete**
   - Use one authenticated, membership-backed request context in every API.
   - Enforce RBAC before use-case execution.
   - Propagate correlation IDs and structured logs.
   - Map typed errors without returning raw internal messages.
   - Implement the API profile from the Enterprise Runtime Contract.

2. **S01.7 Route/domain separation — source gate complete**
   - Replace direct Supabase calls in route handlers with application use cases.
   - Implement infrastructure repositories behind existing domain ports.
   - Prohibit domain state mutation in routes and React components.

3. **S01.8 Transactional Runtime Compliance — conditional**
   - Source transaction, retry, timeout, recovery, audit, outbox, idempotency,
     dead-letter, migration, and performance-smoke primitives pass.
   - Convert every mutating application use case to a database transaction that
     commits business state, audit, and outbox together. Done for Wave 2
     medicine and prescription creation/update (migration 008,
     `create_medicine_record`/`update_medicine_record`/
     `create_prescription_record`). MAR, clinical review, and reservation
     mutations remain non-atomic two-step calls and are Wave 3 scope, deferred
     rather than pulled forward here.
   - Execute migration, rollback, RLS, tenant-isolation, idempotency, and retry
     tests against live PostgreSQL/Supabase.

4. **S01.9 Enterprise Observability and Certification — partial**
   - Add durable metrics, distributed traces, dependency-aware health, runtime
     diagnostics, machine-readable certification, and evidence retention. The
     `apps/web` audit/outbox health checks were hardcoded `true`; they now run
     real dependency checks against `governance_audit_events`/
     `runtime_outbox_events`. Metrics/tracing are still exercised only by unit
     tests, not real traffic.
   - Certify API, Background, AI, Administrative, and placeholder Conversation
     runtime profiles without implementing Wave 2–5 features.

5. **S01.10 Enterprise Test Harness — partial**
   - Add CI quality gates, coverage thresholds, live integration/RLS suites,
     contract compatibility, workflow, performance, recovery, and security
     certification. CI now builds every app workspace (previously only
     `@medlink/web`) and `vitest.config.ts` enforces a coverage threshold over
     `packages/**/src`, uploaded as a CI artifact. Live integration, RLS,
     workflow, performance, recovery, and security suites are still absent.
   - Mark old wave certification documents as historical/pre-CDA and align app
     READMEs after executable evidence is authoritative.

## P1 — Wave 2 certification

6. Execute migrations against local PostgreSQL/Supabase.
7. Add migration and cross-tenant RLS tests.
8. Complete Medicine Knowledge application services and repositories.
9. Integrate equivalency, prescription, clinical, and search APIs through the
   canonical pipeline.
10. Select/configure OCR adapter and test low-confidence and malformed media.
11. Add API contract and clinical workflow tests.
12. Expand clinical rules and document evidence sources and pharmacist controls.
13. Certify Batches 2.1–2.5 independently.

## P1 — Wave 3

14. Implement Conversation Engine domain/application boundaries and schema.
15. Implement WhatsApp webhook, signature, media, identity, consent, and
    delivery adapter.
16. Implement durable Workflow Orchestrator and all applicable canonical
    definitions.
17. Implement a general transactional domain-event outbox and consumers.
18. Reconcile MAR and Reservation state vocabularies across contract, package,
    database, API, and UI.
19. Integrate inventory locking, reservation compensation, pickup, human
    handoff, notification, timeout, retry, ordering, and recovery.
20. Add conversation, workflow, duplicate delivery, replay, outage, recovery,
    concurrency, and end-to-end tests.

## P2 — Waves 4 and 5

21. Complete professional APIs before certifying portal UIs.
22. Remove patient-first assumptions from portal architecture; retain patient
    web only as optional fallback.
23. Complete payment, adherence, analytics, reporting, AI, governance,
    integration, security, certification, and operational adapters.
24. Add metrics, distributed tracing, SLOs, alerts, dependency health, and queue
    health.
25. Execute performance, penetration, backup, restore, and disaster-recovery
    exercises.
26. Complete external conformance evidence for approved RC1 integrations.

## First feature batch

After P0 controls pass, the first feature batch is **Wave 2.1 — Medicine
Knowledge**. No Wave 3 feature should be pulled forward into Wave 2.
