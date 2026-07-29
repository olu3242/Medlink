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
     `create_prescription_record`); done for reservation creation (migration
     010, `reserve_inventory`); done for MAR creation (migration 016,
     `create_mar`, now that Wave 3 has begun) — `AccessApplication.createMar()`
     was a raw single-table insert with no runtime evidence commit until now.
     Done for clinical review decision too (migration 017,
     `decide_clinical_review`) — `AccessApplication.decideReview()` was a
     raw two-step update guarded by `.eq("decision", "pending")`, which also
     had a distinct latent bug: a repeated call with the same decision (a
     client retry after a dropped response) matched zero rows once the
     review was no longer pending and errored via `.single()` instead of
     replaying safely. The new RPC treats the decision itself as the
     idempotency signal (same actor, same decision, same recommendation on
     an already-decided review returns the existing row; anything else
     still raises) since `clinical_reviews` has no per-decision idempotency
     key of its own.
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
     workflow, performance, and recovery suites are still absent.
   - Dependency security: `npm audit` shows 15 high-severity findings, all
     requiring a major-version bump with no safe automatic fix. Assessed and
     documented per-package in `docs/audit/DEPENDENCY_AUDIT.md` rather than
     force-upgraded — real exposure is low (unused `sharp`, build-time-only
     `postcss`, dev-only `eslint`/`vitest` tooling; `next`'s "high" rating is
     entirely inherited from those two, no direct Next.js CVE), and an
     untested major bump risks breaking the build for a low-probability
     finding. Recommended, lowest-risk-first upgrade order is in that
     document.
   - Two previously-untested packages closed: `packages/api` (the runtime
     pipeline `apps/admin`/`apps/patient` route every request through) and
     `standardRuntimeHooks` in `packages/observability` (added in the Sprint
     4 dedup pass with no test of its own until now).
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
   `GET /api/v1/medicines/{id}/equivalency-candidates`, and (after migration
   202607290011 added a first-class `generics` table) `findGenericById` too
   — but the admin catalog's `brands()`/`generics()`/`list()`/`get()` still
   query `medicines` directly rather than through the repository,
   deliberately: routing them through `brandMedicineSchema`'s
   closed-vocabulary validation would risk 404ing an existing medicine
   outside that vocabulary, for no gain since those routes already return
   the correct, tested shape. `createGeneric`/`listGenerics` (the
   `MedicineRepository` write side) remain unimplemented — no route calls
   them yet. See `docs/wave-2-certification.md` "Resolved gaps."
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
    `propose()` wiring) rather than a blanket status. Architecture-level
    gaps discovered while wiring (not previously tracked): no first-class
    generic-medicine entity in the schema — resolved via a `generics` table
    (migration 202607290011, user-authorized design decision, see
    `docs/wave-2-certification.md` "Resolved gaps") — and vocabulary
    mismatches between packages/prescription and packages/clinical and their
    corresponding DB enums, still bridged with explicit translation layers
    rather than resolved, still needing a design decision.

## P1 — Wave 3

14. Implement Conversation Engine domain/application boundaries and schema.
    Done: `packages/conversation` (`Conversation`/`ConversationMessage`/
    `ConversationEvent` models, `ConversationRepository`/`MessageStore`/
    `ConversationEventLog`/`IntentClassifier`/`WorkflowInvoker` ports,
    `ConversationEngine` application service, a default
    `KeywordIntentClassifier`) and migration
    `202607290012_conversation_engine.sql` (`conversations`,
    `conversation_messages`, append-only `conversation_events`, RLS). The
    engine resolves/creates a conversation by channel identity, classifies
    intent, and either hands off to a human (confidence below threshold, or
    an existing handoff in progress) or delegates to a `WorkflowInvoker`
    port — it runs no business rules itself. Supabase-backed
    implementations of `ConversationRepository`/`MessageStore`/
    `ConversationEventLog` now exist too
    (`apps/web/lib/conversation-store.ts`, following
    `apps/admin/lib/medicine-repository.ts`'s adapter-lives-in-the-app
    pattern). Not yet wired to a route or the real WhatsApp adapter — see
    item 15 below, blocked on ADR 0004.
15. Implement WhatsApp webhook, signature, media, identity, consent, and
    delivery adapter. Partial: `packages/whatsapp` implements the transport
    slice ADR 0003 scopes to channel adapters — `verifyWebhookSignature`
    (HMAC-SHA256 over the raw body, per the Cloud API's
    `X-Hub-Signature-256` header), `normalizeInboundPayload` (Cloud API
    webhook JSON → a flat list of typed message/unsupported-message/status
    events), and `GraphApiWhatsAppSender` (outbound send via injected
    `fetch`, so it's unit-testable without live network) — plus migration
    `202607290013`'s `conversation_channel_bindings` table for resolving
    which organization a `phone_number_id` belongs to. **Not built: the
    webhook route itself.** Wiring one exposed a genuine architecture gap
    rather than a wiring gap — see the new finding below.
    - **`RuntimeContext.userId` blocks the Conversation Runtime profile.**
      `docs/ENTERPRISE_RUNTIME_CONTRACT.md` documents `userId` as optional
      (`userId?: string`) specifically so profiles without an authenticated
      end user (Conversation Runtime's webhooks, Background Runtime's
      workers) can populate a context. `packages/runtime`'s actual
      `runtimeContextSchema` requires it as a non-optional
      `z.string().uuid()` — an inbound WhatsApp webhook, which by
      definition has no Supabase-authenticated user, cannot construct a
      valid `RuntimeContext` and therefore cannot call `createRuntime()`'s
      `run()` at all. This is not a bug in `packages/whatsapp` or
      `packages/conversation` to route around; `packages/runtime` is
      frozen platform (see `IMPLEMENTATION.md`'s Platform Freeze Gate) and
      "No component may create a custom execution pipeline or bypass a
      mandatory stage." Building a webhook route today would mean either
      quietly modifying frozen code without an ADR, or hand-rolling a
      parallel pipeline that only claims to satisfy the same obligations —
      both rejected. This needs an accepted ADR deciding how a
      system/webhook identity is represented in `RuntimeContext` before
      route wiring can proceed. Drafted, not accepted:
      `docs/adr/0004-conversation-runtime-webhook-identity.md` — three
      options considered, recommends a well-known system identity
      (`context.userId` stays required and always populated; no existing
      Wave 1/2 RLS policy, RPC signature, or audit consumer changes) over
      making `userId` genuinely optional or giving Conversation Runtime a
      distinct lifecycle outside `createRuntime()`. Also flags that ADR
      0001's "service-role access is not used by request handlers" needs a
      narrow, explicit exception for this one profile's already-scoped
      service-role-only writes (migration 202607290012).
16. Implement durable Workflow Orchestrator and all applicable canonical
    definitions. Partial: `packages/workflows/src/definitions.ts` gives all
    15 canonical workflows a structural step sequence (grounded in the
    existing DB state machines -- `mar_status`, `prescription_status`,
    `extraction_status` -- and `docs/release-scope.md`'s Wave 3 scope list,
    not invented). `WorkflowStep`/`WorkflowInstance` (`service.ts`) now
    carry a `context` a step's output can populate for later steps or the
    caller to read, durably merged in the same store call that marks the
    step complete. One workflow, WF-005 Medicine Search, has a real
    executable step (`medicine-search.ts`) wrapping
    `packages/search`'s `MedicineSearchService` -- the first canonical
    definition backed by an actual domain call rather than just a name.
    Seven of fifteen canonical workflows now have at least one real
    executable step (eight steps total): WF-003 Prescription Upload
    (`prescription-upload.ts`, backed by the atomic
    `create_prescription_record` RPC, previously only called from
    `apps/admin`, via a new `PrescriptionUploader` port), WF-004
    Prescription Parsing (`prescription-parsing.ts`, wrapping
    `packages/prescription`'s `PrescriptionParser` directly, the same
    pattern as WF-005), WF-006 Medication Access Request
    (`mar-creation.ts`, backed by the atomic `create_mar` RPC via a new
    `MarCreator` port), WF-007 Clinical Review (`clinical-review.ts`, two
    steps: `run_clinical_validation` wrapping `packages/clinical`, and
    `pharmacist_review` backed by the atomic `decide_clinical_review` RPC
    via a `ClinicalReviewDecider` port), WF-008 Inventory Discovery
    (`inventory-discovery.ts`, backed by a new `InventoryFinder` port
    reimplementing `AccessApplication.inventory()`'s read-only query), and
    WF-009 Reservation (`reservation.ts`, backed by the existing atomic
    `reserve_inventory` RPC via a `ReservationCreator` port). A new
    `definitions.test.ts` case constructs every real step and asserts its
    `.name` actually appears in its canonical workflow's structural
    definition, guarding against the two silently drifting. Now also
    durable: migration `202607290015` adds `workflow_instances`,
    and `apps/web/lib/workflow-store.ts`'s `SupabaseWorkflowStore`
    implements the port for real. `apps/web/lib/workflow-invoker.ts`'s
    `WorkflowOrchestratorInvoker` wires `packages/conversation`'s
    `WorkflowInvoker` port to this package -- it runs `medicine_search` for
    real and throws `UnsupportedWorkflowTypeError` (not a silent no-op) for
    any other classified intent, since only WF-005 has an executable step
    so far. Still open: no route calls any of this yet (blocked on ADR
    0004, same as Batch 3.1), and the other 14 workflows' steps remain
    structural, not executable.
17. Implement a general transactional domain-event outbox and consumers.
    Investigated this pass: the outbox half already exists and is in real
    use -- `runtime_outbox_events` (migration 202607270006) is exactly a
    general transactional domain-event outbox, and every atomic RPC this
    session has built (`create_medicine_record`, `reserve_inventory`,
    `create_mar`, ...) commits to it via `record_runtime_evidence()` in
    the same transaction as its business state. Its schema
    (`status`/`locked_at`/`locked_by`/`published_at`/`retry_count`/
    `last_error_code`) is clearly designed for a claim-based Background
    Runtime worker per `docs/ENTERPRISE_RUNTIME_CONTRACT.md`'s Background
    Runtime obligations ("claim work atomically with bounded leases...
    bounded retries... dead-letter handling"), but **zero consumers exist**
    -- the only other reference to the table anywhere in the repository is
    a read-only health check (`apps/web/lib/health.ts`). Not built this
    pass, deliberately: a claim/publish/fail RPC set is real, scoped,
    buildable infrastructure, but granting it carelessly is a genuine
    cross-tenant security risk (a claim function callable by any
    `authenticated` user could lock or read another tenant's outbox rows;
    it would need to be `service_role`-only, unlike every other RPC this
    session has built for authenticated end users) -- and even a correctly
    scoped claim mechanism has no real consumer to justify it yet, since
    "what does dispatching `mar.created` actually do" requires selecting
    real downstream integrations (notification provider, webhook
    subscribers), the same class of not-yet-made product decision as the
    still-unselected OCR provider (item 10).
18. Reconcile MAR and Reservation state vocabularies across contract, package,
    database, API, and UI. Audited this pass: `mar_status` (11 values:
    created/validated/reviewed/searching/matched/reserved/paid/dispensed/
    completed/cancelled/expired) and `reservation_status` (6 values:
    pending/confirmed/ready/collected/cancelled/expired) are the only two
    DB enums involved. Every Wave 2/3-owned consumer passes these through
    honestly rather than inventing a competing vocabulary: `toMar`
    (`apps/patient/lib/application.ts`) maps `state` straight to the
    client's `status` field with no relabeling, and
    `PATCH /api/v1/review/{id}`'s `decisionSchema` is contract-tested
    against `clinical_review_decision` (a third, already-reconciled enum).
    No further Wave 2/3 fix needed.
    **New Wave 4 finding, not fixed here (Wave Isolation):**
    `apps/pharmacy/app/reservations/page.tsx` — a Pharmacy Portal (Batch
    4.1) page — PATCHes a reservation with `{status: "declined"}`.
    `"declined"` is not a `reservation_status` value; the write would fail
    with an enum-violation error if it ever reached the database. It
    can't, independently: the page calls `fetch("/api/v1/reservations...")`
    directly with a same-origin relative path instead of using its own
    `apps/pharmacy/lib/api.ts` cross-origin client (the same
    inconsistent-client-usage bug class Sprint 2 fixed in
    `apps/pharmacist/components/decision-form.tsx`), and no
    `GET`/`PATCH /api/v1/reservations[/{id}]` route exists anywhere in the
    repository for it to reach regardless. Three compounding problems, one
    finding: this page has never worked. Left for whoever builds Batch 4.1
    for real, since building the missing endpoint and choosing the correct
    enum-mapped semantics (closest existing value is likely `cancelled`,
    not a new enum member) is real backend design work, not a mechanical
    fix.
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
