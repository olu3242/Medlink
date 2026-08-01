# RC1 Happy-Path Workflow Certification (Engine 35)

Per the FINAL EXECUTION RULE: a scenario this sandbox cannot exercise (no
live Postgres, no live Meta webhook delivery, no deployed environment --
the same limitation `docs/audit/RC1_SPRINT_REPORT.md` Phase 1 first
recorded and every subsequent certification document in this repository
has inherited) is recorded as **Blocked**, with the exact missing
dependency and the evidence that would close it -- never marked failed,
never marked passed without that evidence.

Evidence basis: same integration merge as `WORKFLOW_CATALOG.md` (`main` +
PR #5/#6/#7/#8), `npm run check` green (572/8/0).

## Patient: search medicine, upload prescription, receive confirmation

| Step | Certified today | Evidence | Blocked on |
| --- | --- | --- | --- |
| Search medicine | **Unit-certified** | `packages/workflows/src/medicine-search.test.ts`, `apps/admin/app/api/v1/search/route.contract.test.ts` exercise the step and route contract with fakes | Live-scale/production-index behavior (`ENGINE_STATUS_MATRIX.md`'s Search row already flags "no production-scale index evidence") |
| Upload prescription | **Unit-certified** | `apps/patient/lib/prescription-intake.test.ts` exercises validate -> store -> RPC-call with fakes; `apps/patient/lib/prescription-storage.test.ts` exercises the storage adapter with a scripted client | Live Supabase Storage + `auth.users` system identity execution; live RLS proof that a patient's own upload succeeds and a stranger's is denied |
| Receive confirmation | **Blocked** | `create_prescription_record`'s `record_runtime_evidence` call and the RPC's own returned row are real, but no notification is sent to the patient on success (G09 has zero outbound channels wired -- see `LAUNCH_GAP_MATRIX.md`) | G09 Notification Runtime batch (not yet started) |

## Pharmacist: receive case, review, request clarification, approve

| Step | Certified today | Evidence | Blocked on |
| --- | --- | --- | --- |
| Receive case | **Blocked** | No mechanism pushes a new case to a pharmacist (no notification, and it's unverified whether `apps/pharmacist/app/review/[id]/page.tsx` is a queue or a single-case view) | G09; a direct read of the pharmacist app's queue page (not done in this pass) |
| Review | **Unit-certified** | `packages/clinical/src/validation.test.ts` (rule engine), `packages/workflows/src/clinical-review.test.ts` | Live RLS proof of queue scoping to the reviewing pharmacist's organization |
| Request clarification | **Blocked** | `clinical_reviews` has a `needs_information` value in its decision vocabulary (confirmed present in `decide_clinical_review`'s domain, not independently re-verified column-by-column in this pass), but no route or test exercises that specific transition | A route/test asserting the `needs_information` path preserves conversation context back to the patient |
| Approve | **Unit + static-DB certified** | `decide_clinical_review`'s atomicity, idempotent replay, and concurrency-race guard are all covered by `packages/runtime/src/migration.test.ts`'s SQL-content assertions; `clinical-review.test.ts` covers the step | Live execution of the actual UPDATE race the SQL guards against -- the assertion proves the guard clause exists in the deployed function body, not that it behaves correctly under real concurrent load |

## Inventory: search stock, reserve medicine, update availability

| Step | Certified today | Evidence | Blocked on |
| --- | --- | --- | --- |
| Search stock | **Unit-certified** | `packages/workflows/src/inventory-discovery.test.ts` | Not MAR-scoped (`RC1_BACKLOG.md` item 19) -- a real search doesn't know which MAR it's satisfying |
| Reserve medicine | **Unit + static-DB certified, UI incomplete** | `packages/workflows/src/reservation.test.ts`, `reserve_inventory`'s replay-validation SQL assertions | `apps/patient/app/reserve/[inventoryId]/page.tsx` posts an incomplete payload (`ENGINE_STATUS_MATRIX.md`'s Reservation row) -- the RPC works, the UI that would call it correctly doesn't yet; and no MAR can reach `state = 'matched'` to satisfy the RPC's precondition (same item 19) |
| Update availability | **Static-DB certified** | `sync_inventory_lock_quantity()` trigger moves quantity atomically (migration `202607270003`), asserted by content in `migration.test.ts` | Live proof under concurrent reservation attempts -- see `FAILURE_TEST_MATRIX.md`'s inventory-conflict row |

## Notifications: confirmation, review result, reservation

**Blocked, entirely.** `docs/audit/LAUNCH_GAP_MATRIX.md`'s G09 finding,
re-confirmed in this pass: zero `NotificationChannel` implementations,
zero `OutboxDispatcher` callers, `GraphApiWhatsAppSender` unused outside
its own tests (`grep -rl GraphApiWhatsAppSender apps/` still returns
nothing on the integration branch). No notification of any kind can be
certified because none can be sent. Unblocking this is the G09 batch,
already scoped and awaiting go-ahead.

## Overall happy-path verdict

**No single lifecycle stage is end-to-end certified against a live
environment.** Every stage has genuine, real, unit/contract-level
certification for its own internal logic (validation, atomicity,
idempotency, RBAC re-enforcement) -- this is not source-incomplete work,
it is real engineering with real test coverage. What's missing across the
board is the same two things: (1) live execution evidence, which this
sandbox structurally cannot produce, and (2) the chaining connections
`WORKFLOW_DEPENDENCY_MATRIX.md`'s "Chaining gaps" section lists explicitly
-- each a specific, small, already-diagnosed piece of work, not a vague
aspiration.
