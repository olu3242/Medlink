# RC1 P0 Convergence Sprint Report

Scope: close the P0 findings from the prior certification pass without
expanding product scope, adding features, or starting a future wave. Seven
sprints; this document is the record of what changed, what was found but
deliberately not fixed, and what remains.

## Sprint 1 — Inventory Reservation Recovery

`apps/patient/lib/application.ts`'s `AccessApplication.reserve()` called
`this.database.rpc("reserve_inventory", {...})` — a function that did not
exist in any migration. The reservation-creation path was not flaky or
undertested; it failed unconditionally.

Implemented in `supabase/migrations/202607290010_reserve_inventory.sql`.
It does not invent new concurrency machinery: `inventory_locks`' existing
`sync_inventory_lock_quantity()` trigger (migration `202607270003`) already
moves quantity from `inventory_batches` into a lock via an atomic
`UPDATE ... WHERE` that only succeeds if enough unreserved stock exists —
Postgres's row-level locking makes this safe under concurrent callers with
no extra version column or retry loop needed. `reserve_inventory`'s job is
only to orchestrate the existing tables in one transaction:

1. Authenticate the actor and re-enforce the `reservations_create` RLS
   policy (patient owns the MAR, or staff role) — required because
   `SECURITY DEFINER` bypasses RLS.
2. Replay idempotently: same `(organization_id, idempotency_key)` returns
   the prior result rather than re-executing.
3. Verify the MAR is in `matched` state (the state machine's own
   precondition for `reserved` — not relaxed).
4. Create the reservation, then the inventory lock (the trigger enforces
   stock availability and raises `'Insufficient or unavailable inventory
   for lock'` if not, rolling back everything before it).
5. Advance the MAR `matched` → `reserved` transition.
6. Record runtime evidence.

Any failure at any step rolls back the whole function — this is inherited
from Postgres transaction semantics, not implemented separately.

**Found but not fixed, and why:** `apps/patient/app/reserve/[inventoryId]/
page.tsx` posts `{inventoryId}` only. `reserve_inventory` requires `marId`,
`pharmacyLocationId`, `quantity`, and `expiresAt`, none of which this page
collects, and there is no code path anywhere that transitions a MAR to
`matched` (that's the Workflow Orchestrator's job — Wave 3, not started).
Renaming a field wouldn't make this work; deciding where `marId` comes from,
what quantity to request, and what expiry policy to apply is real
workflow-UX design, which is Wave 3 scope. Fixing the RPC's existence was
this sprint's job; fixing the UI's missing inputs is the next wave's.

## Sprint 2 — Pharmacist Workflow Alignment

`apps/pharmacist/components/decision-form.tsx` posted to
`POST /api/v1/review/{id}/decision` (nonexistent) with decision values
(`approve`/`approve_equivalent`/`reject`/`needs_information`) and a field
name (`rationale`) that didn't match the real endpoint
(`PATCH /api/v1/review/{id}`, `{decision: "approved"|"rejected"|
"needs_information", recommendation: string}`), and didn't route through
the cross-origin API client (`MEDLINK_API_URL`) its own read calls use —
so even a corrected path/method would have hit this app's own,
route-less origin.

Fixed: added `decide()` to `apps/pharmacist/lib/api.ts` alongside the
existing `queue()`/`review()`; corrected the form's enum (dropping
`approve_equivalent`, which has no corresponding `clinical_review_decision`
value — see Sprint 3) and field name. Regression-tested in
`apps/pharmacist/lib/api.test.ts`.

**Still open:** this app has no session of its own to authenticate the
cross-origin call with. Every call — reads included — is effectively
unauthenticated until Wave 4 portal authentication exists.

## Sprint 3 — API Contract Reconciliation

Surfaced two distinct classes of problem.

**Dead client references** (client calls a path with no backing route
anywhere): `apps/dashboard` (4: `dashboard`, `notifications`, `payments`,
`adherence`), `apps/developer` (4: `developer/clients`,
`developer/webhooks`, `developer/webhook-deliveries`, `integrations`),
`apps/provider` (1: `provider/activity`). Not fixed — building these
backends is Wave 4/5 feature work, not a contract fix, and these apps are
already correctly marked "Scaffolded/Fail." READMEs updated to say so
explicitly rather than implying the calls work.

**Response/request shape drift on already-shipped, supposedly-working
paths** — the more serious finding, since these aren't unbuilt features,
they're active bugs in Wave 1-3 code:

- `apps/admin`'s catalog table read `medicine.name`/`genericName`/
  `strength`/`dosageForm` — none of which exist on a raw `medicines` row
  (`brand_name`/`generic_name`/`strength_display`/`dosage_form`). The
  catalog table rendered blank for every column but `id` and `status`.
- The medicine form submitted a `name` field the server schema doesn't
  have (silently dropped by Zod), while its actual required `brandName`
  field was optional in the UI and pre-filled from the same broken read
  path — so it was also always empty on the edit form. An unused
  `therapeuticClass` field was submitted and silently discarded (the DB
  column is `therapeutic_class_id`, a FK, not free text).
- `apps/patient`'s home page and MAR detail page read `mar.status`/
  `medicineName` — the DB column is `state`, not `status`, and there's no
  `medicineName` column (it's on the joined `medicines` row). The detail
  page called `mar.status.toLowerCase()` unconditionally, which crashes on
  `undefined` — this page 500'd, not just rendered blank.
- `apps/patient`'s search page read `match.distanceKm.toFixed(1)`
  unconditionally; there is no geospatial distance calculation anywhere in
  the repository, so this always crashed. Replaced with the pharmacy's real
  `locality` field instead of fabricating a number.
- `/api/v1/inventory` silently ignored its own `q` query parameter — search
  never actually filtered anything, returning the same unfiltered list
  regardless of query.

Fixed with response-mapping functions (`toMedicineSummary`/
`toMedicineDetail`, `toMar`, `toMatch`) centralizing the snake_case →
camelCase conversion in each app's `application.ts`, all using data already
available on existing joins — no new tables, columns, or endpoints.
Regression-tested in `apps/admin/lib/application.test.ts` and
`apps/patient/lib/application.test.ts`.

## Sprint 4 — Runtime Deduplication

`apps/web/lib/api-runtime.ts`'s `runWebApi` and `packages/api/src/index.ts`'s
`runApi` independently implemented identical audit/events/telemetry hooks
(same log messages and structure, differing only in the `service` label),
and had drifted — the web copy's log entries were missing an `event`
attribute the api copy already tagged, which an event-filtered log query
would silently miss.

Their `authenticate()` implementations legitimately stay separate:
`apps/web` reads a cookie session (`resolveRequestContext`), `packages/api`'s
callers read a bearer `Authorization` header (`requestDatabase`) — two
different auth transports for two different kinds of caller, not accidental
duplication. Unifying that would mean designing a pluggable-auth runtime,
which is new abstraction this sprint's rules explicitly rule out.

Extracted the genuinely-identical part into `standardRuntimeHooks(service)`
in `packages/observability`; both callers now use it. Net effect: both
files ~40% shorter, the event-tagging drift is gone, and the one real
difference between them (auth transport) stays exactly where it belongs.

## Sprint 5 — Test Expansion

Added direct tests for every mapper function introduced in Sprint 3, plus
the pharmacist `decide()` client from Sprint 2. Writing the `toMar`/
`toMatch` tests caught a real bug the fix itself hadn't: both used `??` for
their name/fallback chains, which only falls through on `null`/`undefined`,
not on an empty string. Current DB constraints happen to make
`brand_name`/`generic_name` always non-empty, so this couldn't fire against
real data today — but it was one schema change away from silently
regressing to the same blank-render bug Sprint 3 just fixed. Switched both
to `||`.

No skipped test was newly enabled. The one skip
(`packages/runtime/src/live-database.test.ts`) still requires
`MEDLINK_LIVE_SUPABASE_URL`/`_ANON_KEY`, which remain unset — see Phase 1
below for exactly why.

## Sprint 6 — Documentation

- `docs/wave-3-certification.md`, `wave-4-certification.md`, and
  `wave-5-certification.md` used a pre-CDA wave grouping that actively
  conflicts with the current Wave 1-5 plan in `docs/release-scope.md`
  (their "Wave 3" is MAR/reservation; their "Wave 4" is notification/
  payment/dashboard). Marked historical with a banner pointing to the
  authoritative source, rather than deleted — their invariant/checklist
  content is still accurate for what it describes, just not current wave
  status. Closes `docs/audit/RC1_BACKLOG.md`'s long-open item asking for
  exactly this.
- `apps/dashboard`, `apps/developer`, `apps/provider`, and `apps/pharmacist`
  READMEs now state plainly which of their API calls have no backing route
  yet, and (for pharmacist) that cross-origin calls are unauthenticated.
- `docs/audit/RC1_BACKLOG.md`, `ENGINE_STATUS_MATRIX.md`, and
  `CERTIFICATION_GAP.md` updated throughout to reflect every change above.

## Sprint 7 — Final Verification

```
npm run lint        # clean
npm run typecheck   # clean, all apps + packages
npm run test:coverage
#   38 files, 99 tests passed, 1 skipped
#   86.45% / 81.18% / 80.55% / 86.45% stmts/branches/fns/lines
#   (gate: 70/70/65/70 over packages/**/src)
npm run build        # all 8 app workspaces compile
git diff --check     # clean
```

## Phase 1 — Environment assessment (why live certification is still blocked)

Checked directly, not assumed:

| Prerequisite | Result |
| --- | --- |
| Docker Engine installed | Pass — 29.3.1 |
| Docker Engine running | Pass once started manually (not running by default) |
| Supabase CLI | Pass — 2.110.0 via npx |
| `supabase/` directory valid | Pass — `config.toml` + 10 migrations |
| Container registry reachable | **Fail** — 403 on CONNECT to `production.cloudfront.docker.com:443` |
| Live-DB env vars present | Fail — `MEDLINK_LIVE_SUPABASE_URL`/`_ANON_KEY` unset (nothing to point them at) |

The precise blocker: Docker itself works — the daemon starts and runs
cleanly. `supabase start` needs to pull roughly ten container images
(Postgres, GoTrue, PostgREST, Kong, Studio, etc.), and this session's
network egress allowlist only permits `registry.npmjs.org`, `jsr.io`,
`pypi.org`, `files.pythonhosted.org`, `index.crates.io`, `proxy.golang.org`,
and private IP ranges — no container registry. That is a session-level
network policy boundary, not a missing local tool, and per this
environment's own operating rules, policy denials are reported rather than
routed around.

**Smallest fix:** run migration apply, RLS, and integration testing in a
session/environment whose egress policy allows the registries Supabase's
CLI pulls from, or point `MEDLINK_LIVE_SUPABASE_URL`/`_ANON_KEY` at an
already-running Postgres/Supabase instance reachable directly (no image
pulls required).

## What's left

- Everything in Phase 1 — live migration, RLS, and integration
  certification.
- The reservation UI (Sprint 1's "found but not fixed").
- Two open design decisions carried from the prior pass: the
  generic-medicine entity gap (blocks Batch 2.1 reads and generic search)
  and OCR provider selection.
- Wave 3 feature work: Conversation Engine, WhatsApp adapter, Workflow
  Orchestrator, MAR/Reservation state-vocabulary reconciliation, pickup and
  fulfillment (WF-010/WF-011, entirely unimplemented).
- Wave 4/5 backends for the nine dead client references found in Sprint 3.

## Continuation — closing the remaining Wave 2 P1 items

A follow-up pass closed five more items from `docs/audit/RC1_BACKLOG.md`'s
"P1 — Wave 2 certification" list that didn't require live infrastructure or
an external design decision:

- **Static RLS assertions** (`packages/runtime/src/wave2-rls.test.ts`) for
  all six Wave 2 tables the Sprint 1-3 routes write to — not a live
  cross-tenant matrix, but a real guard against a future migration edit
  silently dropping RLS or a policy.
- **`SupabaseMedicineCatalogReader`** (`apps/admin/lib/medicine-repository.ts`)
  closed a gap the original wiring pass left open:
  `CatalogEquivalencyService.assertReviewed()` had a real caller, but
  `.propose()` — the algorithmic half of Batch 2.2 — didn't, until
  `GET /api/v1/medicines/{id}/equivalency-candidates`. Deliberately not
  used to reroute `CatalogApplication.get()`/`list()`: those already return
  the correct, tested shape, and forcing them through
  `brandMedicineSchema`'s closed-vocabulary validation would risk 404ing an
  existing medicine for no functional gain.
- **Two more clinical rules** (`PatientAllergyRule`, `PolypharmacyRiskRule`)
  alongside `DuplicateTherapyRule`, same advisory-only, pharmacist-review-
  required invariant.
- **API contract tests** for the four Wave 2 write/search routes, locking
  each Zod schema to its real DB enum. Moving each schema into a sibling
  `schema.ts` module (rather than exporting it from `route.ts` directly)
  wasn't a style choice — the first attempt broke `npm run build`, because
  Next.js's route-file type validation only permits specific recognized
  exports from `route.ts`. Caught by actually running the build, not
  assumed from a passing typecheck.
- **`docs/wave-2-certification.md`** rewritten with a per-item evidence
  basis instead of a blanket checklist, and its stale "Docker Desktop or
  Podman is not currently available" line corrected to match the Phase 1
  finding above (Docker works; the registry-pull egress policy is the
  actual blocker).

`npm run check` (135 tests, up from 99) and `npm run build` (all 8
workspaces) both pass clean after this continuation.

## Generic-medicine entity gap — resolved

User-authorized design decision (asked directly rather than assumed, since
this was a genuine architecture choice, not an engineering judgment call):
add a first-class `generics` table. Migration `202607290011_generics.sql`:

- `public.generics` (`canonical_name`, `normalized_name`,
  `therapeutic_class_id`, `controlled_substance`, `status`, timestamps) —
  the schema-level counterpart to `packages/medicine`'s `GenericMedicine`.
  Deliberately distinct from `public.active_ingredients`, which remains the
  ingredient-composition source `CatalogEquivalencyService.propose()` uses
  for equivalency matching — a different axis (marketed generic-name
  catalog entity vs. pharmacological substance), not merged into one table.
- Backfilled from every distinct existing `medicines.generic_name`
  (`group by lower(trim(generic_name))`, aggregating
  `controlled_substance` with `bool_or` across brands sharing a name).
  `medicines.generic_id` links each brand row to its generic;
  `medicines.generic_name` (text) is kept, not dropped, since existing read
  paths depend on it directly.
- A `sync_medicine_generic()` trigger (`before insert or update of
  generic_name on medicines`) finds-or-creates the matching `generics` row
  and sets `generic_id` on every future write — the same "orchestrate via
  trigger" pattern `sync_inventory_lock_quantity` already established,
  rather than duplicating find-or-create logic inside
  `create_medicine_record`/`update_medicine_record` (migration 008) or
  every future write path.
- RLS mirrors `active_ingredients`: read to any authenticated user where
  not deleted, write restricted to `is_platform_admin()`.
- `SupabaseMedicineCatalogReader.findGenericById` and
  `SupabaseSearchMedicineReader.findGenericsByIds`
  (`apps/admin/lib/medicine-repository.ts`, `medicine-search.ts`) now query
  it for real, through a new `toGenericMedicine` mapper following the same
  "safeParse, return null rather than throw or coerce" precedent
  `toBrandMedicine` set — a generic with no `therapeutic_class_id` assigned
  yet fails `genericMedicineSchema`'s required `therapeuticClass` and maps
  to `null`, an honest gap rather than a fabricated value.
- `TrigramMedicineSearchIndex.search()` now returns real `generic`-type
  hits against `generics.canonical_name`'s trigram index, alongside the
  existing brand hits, instead of unconditionally returning `{ hits: [] }`
  for any request that included `"generic"`.
- Static certification tests: 4 new cases in
  `packages/runtime/src/migration.test.ts` (table/RLS shape, backfill,
  sync trigger) and 1 in `wave2-rls.test.ts`; 3 new `toGenericMedicine`
  cases in `apps/admin/lib/medicine-repository.test.ts`.

Not touched, deliberately: `CatalogApplication.brands()`/`generics()`/
catalog `list()`/`get()` (`apps/admin/lib/application.ts`) still query
`medicines` directly rather than through the repository — that was never
blocked on the missing `generics` table, it's the same closed-vocabulary
404 risk `toBrandMedicine`'s precedent already documented, unrelated to
this gap. `MedicineRepository.createGeneric`/`listGenerics` (the write
side) remain unimplemented — no route calls them, so there was nothing to
wire; only `MedicineCatalogReader`'s read side had real callers.

`npm run check` (150 tests, up from 142) and `npm run build` (all 8
workspaces) both pass clean after this migration.

## Wave 3 begins — Batch 3.1: Conversation Engine domain/application boundaries and schema

User-authorized: "Begin Wave 3" (the other half of the same two-question
decision that authorized the `generics` table above). Scoped to exactly
RC1_BACKLOG P1 item 14 — domain/application boundaries and schema — not
the WhatsApp adapter (item 15), not Workflow Orchestrator's own
implementation (Batch 3.2), and not any route wiring, per Wave Isolation
and "implement only the contracts ... necessary for future integration."

- **`packages/conversation`** (new package, mirrors `packages/medicine`'s
  layout): `Conversation`/`ConversationMessage`/`ConversationEvent` models;
  `ConversationRepository`/`MessageStore`/`ConversationEventLog`/
  `IntentClassifier`/`WorkflowInvoker` ports; a `ConversationEngine`
  application service; a default `KeywordIntentClassifier`. Per
  `docs/release-scope.md`'s CDA section, the engine owns dialogue only —
  session resolution by channel identity, intent detection, human handoff,
  and an append-only decision log — and runs no business rules itself: it
  delegates every durable process to a `WorkflowInvoker` port rather than a
  direct `@medlink/workflows` dependency, the same hexagonal-boundary
  discipline `MedicineCatalogReader` and `ClinicalRule` already establish,
  so Batch 3.2's eventual Workflow Orchestrator implementation can satisfy
  the port without `packages/conversation` changing.
- Intent below a confidence threshold (`KeywordIntentClassifier` returns 0
  confidence for anything it doesn't recognize, rather than guessing)
  triggers a handoff instead of invoking a workflow — the same
  escalate-rather-than-decide posture `packages/clinical`'s advisory-only
  rules already use, applied to routing instead of clinical findings.
- **Migration `202607290012_conversation_engine.sql`**: `conversations`,
  `conversation_messages`, and an append-only `conversation_events` (reuses
  the existing `prevent_enterprise_event_mutation()` trigger from migration
  007 rather than a new mechanism). `conversation_messages`/
  `conversation_events` are worker-only through the service role — the
  same pattern `notification_outbox`/`notification_delivery_attempts`
  (migration 202607270004) already established — because an inbound
  WhatsApp webhook has no authenticated end-user session to attach RLS to;
  `conversations` itself gets an authenticated read/admin-manage policy so
  a future support portal can use it directly. Deduplicates inbound
  provider messages on `(organization_id, external_message_id)`.
- Static certification tests: 3 new cases in
  `packages/runtime/src/migration.test.ts`, and a new
  `packages/runtime/src/wave3-rls.test.ts` (5 cases) following
  `wave2-rls.test.ts`'s precedent exactly, including an explicit assertion
  that no authenticated write policy exists on the worker-only tables.
  25 new tests total in `packages/conversation` (`service.test.ts`,
  `validation.test.ts`) using hand-rolled in-memory port fakes, the same
  style `packages/medicine/src/equivalency.test.ts` uses.

Not built in this pass, deliberately: no route calls `ConversationEngine`,
no Supabase-backed implementation of its ports exists, and there is no
WhatsApp adapter — those are RC1_BACKLOG item 15, the natural next step,
not folded in here to keep this batch's diff reviewable and its scope
verifiable against a single backlog item.

`npm run check` (175 tests, up from 150) and `npm run build` (all 8
workspaces) both pass clean after this migration. No app yet depends on
`@medlink/conversation`, so the build change is additive only.
