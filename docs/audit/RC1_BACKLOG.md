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
   - Follow-up (not a gate blocker): `apps/web/lib/api-runtime.ts`'s
     `runWebApi` and `packages/api/src/index.ts`'s `runApi` independently
     re-implement the same runtime lifecycle rather than sharing one
     implementation, and `runApi` additionally wires a transactional journal
     `runWebApi` lacks. Both are individually conformant; consolidating them
     touches the frozen platform and needs an ADR, not a quiet merge.
   - Also discovered: `apps/dashboard`, `apps/developer`, and `apps/provider`
     collectively reference 9 API paths (`dashboard`, `notifications`,
     `payments`, `adherence`, `developer/clients`, `developer/webhooks`,
     `developer/webhook-deliveries`, `integrations`, `provider/activity`)
     with no backing route anywhere — expected for Wave 4/5 UI scaffolds
     built ahead of their APIs, confirmed rather than assumed.

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
   - Mark old wave certification documents as historical/pre-CDA. Done:
     `docs/wave-3-certification.md`, `wave-4-certification.md`, and
     `wave-5-certification.md` used a pre-CDA wave grouping that actively
     conflicts with the current Wave 1-5 plan in `docs/release-scope.md`
     (their "Wave 3" is MAR/reservation, now Wave 2's tail and Wave 3's
     integration target; their "Wave 4" is notification/payment/dashboard,
     now split across current Wave 4 and 5) — banners now point to the
     authoritative source rather than silently conflicting with it. App
     README alignment is still open.

## P1 — Wave 2 certification

6. Execute migrations against local PostgreSQL/Supabase.
7. Add migration and cross-tenant RLS tests. Partial: static RLS assertions
   (RLS enabled + every policy exists) now cover all six Wave 2 tables the
   Sprint 1-3 routes write to (`packages/runtime/src/wave2-rls.test.ts`).
   These fail loudly if a future migration edit drops RLS or a policy, but
   they are not a live cross-tenant denial matrix — that still needs item 6.
8. Complete Medicine Knowledge application services and repositories. Partial:
   write paths (`create`/`update`) are atomic via `create_medicine_record`/
   `update_medicine_record` (migration 008); a real `SupabaseMedicineCatalogReader`
   repository now exists (`apps/admin/lib/medicine-repository.ts`) and powers
   `CatalogEquivalencyService.propose()` via
   `GET /api/v1/medicines/{id}/equivalency-candidates` — but read paths
   (`brands`/`generics`/catalog `list`/`get`) still query `medicines`
   directly rather than through it, deliberately: routing them through
   `brandMedicineSchema`'s closed-vocabulary validation would risk 404ing an
   existing medicine outside that vocabulary, for no gain since those routes
   already return the correct, tested shape. Blocked on the
   generic-medicine-entity gap for full completion, not on the repository
   not existing — see `docs/wave-2-certification.md` "known gaps."
9. Integrate equivalency, prescription, clinical, and search APIs through the
   canonical pipeline. Done: `PATCH /api/v1/equivalents/{id}/review`,
   `POST /api/v1/prescriptions/{id}/extract`,
   `POST /api/v1/prescriptions/{id}/validate`, `GET /api/v1/search` (migration
   009, `apps/admin/lib/application.ts`, `apps/admin/lib/
   prescription-extraction.ts`, `apps/admin/lib/medicine-search.ts`). All four
   domain packages (medicine, prescription, clinical, search) now have at
   least one real route consumer instead of being exercised only by their own
   unit tests.
10. Select/configure OCR adapter and test low-confidence and malformed media.
    Still open: the extraction route uses an explicitly-placeholder
    zero-confidence reader (`PendingOcrPrescriptionReader`) pending provider
    selection.
11. Add API contract and clinical workflow tests. Partial: API contract
    tests now lock the four Wave 2 write/search routes' Zod schemas to their
    real DB enums (`route.contract.test.ts` next to each route) — added
    after the review-decision endpoint was found to accept a value
    (`changes_requested`) its DB enum has never had. Full clinical
    *workflow* tests (multi-step, e.g. upload → extract → validate → review)
    still need live infrastructure.
12. Expand clinical rules and document evidence sources and pharmacist
    controls. Done: `PatientAllergyRule` and `PolypharmacyRiskRule` added
    alongside `DuplicateTherapyRule` (`packages/clinical/src/validation.ts`),
    all advisory-only, all requiring pharmacist acknowledgement, none
    auto-deciding.
13. Certify Batches 2.1–2.5 independently. Evidence-based checklist in
    `docs/wave-2-certification.md` reflects this pass's actual state per
    item (migration/RLS static tests, contract tests, clinical rules,
    `propose()` wiring) rather than a blanket status. New
    architecture-level gaps discovered while wiring (not previously tracked):
    no first-class generic-medicine entity in the schema, and vocabulary
    mismatches between packages/prescription and packages/clinical and their
    corresponding DB enums, bridged with explicit translation layers rather
    than resolved. These need a design decision, not a mechanical fix.

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
    `reserve_inventory` is now implemented (migration `202607290010`,
    `docs/audit/RC1_SPRINT_REPORT.md`) — it orchestrates the existing
    `sync_inventory_lock_quantity` trigger (already atomic and
    concurrency-safe) rather than new locking logic: reservation +
    inventory lock + MAR `matched`→`reserved` transition + evidence commit
    atomically, idempotent on `(organization_id, idempotency_key)`. Still
    open: `apps/patient/app/reserve/[inventoryId]/page.tsx` posts
    `{inventoryId}` only — missing `marId`/`pharmacyLocationId`/`quantity`/
    `expiresAt` — and no code path transitions a MAR to `matched`, so the
    reservation UI cannot successfully call this function yet. That's
    genuine workflow-UX design work (where does `marId` come from, what
    quantity, what expiry policy), not a field-rename fix — left for Wave 3's
    Workflow Orchestrator rather than forced now. Pickup/fulfillment
    (WF-010/WF-011) remain entirely unimplemented.
20. Add conversation, workflow, duplicate delivery, replay, outage, recovery,
    concurrency, and end-to-end tests.
20a. Fixed `apps/pharmacist/components/decision-form.tsx`, which posted to
    `/api/v1/review/{id}/decision` (nonexistent — the real endpoint is
    `PATCH /api/v1/review/{id}`) with decision values and a field name that
    didn't match that endpoint's contract, and didn't route through the
    cross-origin API client its own read calls use. Fixed and tested
    (`apps/pharmacist/lib/api.test.ts`). Still open: this app has no session
    of its own to authenticate the cross-origin call with — Wave 4 portal
    authentication.
20b. Fixed a class of bug distinct from dead API references: several
    already-shipped read paths (`apps/admin` catalog, `apps/patient` MAR
    home/detail, `apps/patient` inventory search) returned raw snake_case
    Supabase rows to clients whose TypeScript types and JSX expect camelCase
    fields that don't exist on those rows — the admin catalog table
    rendered blank for every column but id/status, and the patient MAR
    detail page and search page both crashed outright on properties that
    were always undefined. See `docs/audit/RC1_SPRINT_REPORT.md` for the
    full list and `apps/admin/lib/application.test.ts` /
    `apps/patient/lib/application.test.ts` for regression coverage.

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
