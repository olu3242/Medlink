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
     commits business state, audit, and outbox together.
   - Execute migration, rollback, RLS, tenant-isolation, idempotency, and retry
     tests against live PostgreSQL/Supabase.

4. **S01.9 Enterprise Observability and Certification — conditional**
   - Add durable metrics, distributed traces, dependency-aware health, runtime
     diagnostics, machine-readable certification, and evidence retention.
   - Certify API, Background, AI, Administrative, and placeholder Conversation
     runtime profiles without implementing Wave 2–5 features.
   - Source gates, durable adapters/schema, profile certification, and evidence
     retention pass. Live persistence and RLS evidence remain gated by S01.10.

5. **S01.10 Enterprise Test Harness — conditional**
   - Add CI quality gates, coverage thresholds, live integration/RLS suites,
     contract compatibility, workflow, performance, recovery, and security
     certification.
   - Mark old wave certification documents as historical/pre-CDA and align app
     READMEs after executable evidence is authoritative.
   - CI, coverage, type, lint, source contract, and secret-gated live database
     suites pass at source level. Live RLS and recovery evidence remain pending.

## P1 — Wave 2 certification

6. **Execute migrations against isolated PostgreSQL/Supabase — complete**
   - GitHub Actions run 20 successfully started Supabase and reset the database
     across the complete RC1 migration chain.
   - The same 14-migration chain applied successfully to the configured hosted
     project on 2026-07-30.
7. **Add migration and cross-tenant RLS tests — source/isolated complete**
   - Migration structure and the complete tenant RLS matrix pass source tests.
   - The hosted anonymous runtime-outbox RLS probe passes.
   - Broader authenticated cross-tenant fixtures remain pending environment
     identities.
8. Complete Medicine Knowledge application services and repositories.
   - Application service and repository ports pass source certification.
9. Integrate equivalency, prescription, clinical, and search APIs through the
   canonical pipeline.
   - Equivalency, prescription media/confidence, and clinical hard-stop services
     pass source certification; live API integration remains pending.
10. Select/configure OCR adapter and test low-confidence and malformed media.
11. Add API contract and clinical workflow tests.
12. Expand clinical rules and document evidence sources and pharmacist controls.
13. Certify Batches 2.1–2.5 independently.
   - Batches 2.1–2.5 pass source certification. Live database, RLS, API, and
     configured OCR-provider evidence remain required for final certification.

## P1 — Wave 3

14. Implement Conversation Engine domain/application boundaries and schema.
15. Implement WhatsApp webhook, signature, media, identity, consent, and
    delivery adapter.
16. Implement durable Workflow Orchestrator and all applicable canonical
    definitions.
17. Implement a general transactional domain-event outbox and consumers.
18. Reconcile MAR and Reservation state vocabularies across contract, package,
    database, API, and UI.
   - Items 14–18 pass source certification: conversation persistence and
     handoff boundaries, verified WhatsApp normalization, durable canonical
     workflows, retry/dead-letter outbox dispatch, and aligned MAR/reservation
     states are implemented.
   - Live database/RLS validation and configured WhatsApp provider delivery
     evidence remain required for final certification.
19. Integrate inventory locking, reservation compensation, pickup, human
    handoff, notification, timeout, retry, ordering, and recovery.
20. Add conversation, workflow, duplicate delivery, replay, outage, recovery,
    concurrency, and end-to-end tests.
   - Items 19–20 pass source certification with ordered fulfillment,
     compensation, pickup, notification, handoff, replay, outage, and stale
     concurrent-transition coverage.

## P2 — Waves 4 and 5

21. Complete professional APIs before certifying portal UIs.
22. Remove patient-first assumptions from portal architecture; retain patient
    web only as optional fallback.
23. Complete payment, adherence, analytics, reporting, AI, governance,
    integration, security, certification, and operational adapters.
   - Items 21–23 pass source certification with a role-scoped professional API
     catalog, professional-first portal architecture, provider identity, and
     health-checked idempotent operational adapter registry.
   - Portal route deployment and configured external-provider evidence remain
     required for final runtime certification.
24. Add metrics, distributed tracing, SLOs, alerts, dependency health, and queue
    health.
   - Source certification passes: runtime metrics and tracing are joined by SLO
     evaluation, error budgets, dependency/queue/dead-letter alerts, and linked
     recovery runbooks.
25. Execute performance, penetration, backup, restore, and disaster-recovery
    exercises.
   - Exercise contracts, completeness gates, encrypted-backup integrity, and
     restore record-count verification pass source tests.
   - Environment-backed penetration, backup, restore, and DR execution remains
     required before runtime certification can pass.
26. Complete external conformance evidence for approved RC1 integrations.
   - The conformance registry rejects internal-only, incomplete, or failed
     evidence and accepts only complete approved external profiles.
   - OCR, WhatsApp, payment, FHIR/HL7, and approved-partner sandbox artifacts
     remain external certification gates.

## First feature batch

After P0 controls pass, the first feature batch is **Wave 2.1 — Medicine
Knowledge**. No Wave 3 feature should be pulled forward into Wave 2.
