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

## Wave 3 continues — WhatsApp channel adapter transport slice, and a real architecture blocker found

Continuing Batch 3.1 under the same "Begin Wave 3" authorization, toward
RC1_BACKLOG item 15 (WhatsApp webhook, signature, media, identity,
consent, delivery adapter).

- **`packages/whatsapp`** (new package): `verifyWebhookSignature`
  (HMAC-SHA256 over the raw body against the Cloud API's
  `X-Hub-Signature-256` header, using `timingSafeEqual` and checking length
  before comparing so an invalid signature never leaks length information
  through a thrown-vs-returned distinction); `normalizeInboundPayload`
  (parses the Cloud API's nested webhook JSON into a flat list of
  discriminated `message`/`unsupported_message`/`status` events — an
  unrecognized WhatsApp message type like `audio` or `location` is
  surfaced as `unsupported_message` rather than dropped or forced into
  `text`, so a future route can hand it to a human instead of losing it
  silently); `GraphApiWhatsAppSender` (outbound send with an injected
  `fetch`, so delivery is unit-tested against a mocked response rather
  than skipped as "needs live network," the same dependency-injection
  precedent `packages/api/src/index.test.ts` set for `requestDatabase`).
  18 new tests.
- **Migration `202607290013_conversation_channel_bindings.sql`**: maps a
  provider channel identifier (a WhatsApp Business `phone_number_id`) to
  the organization that owns it — the piece a future webhook route needs
  to resolve tenant context from an inbound payload, before anything else
  can happen. RLS mirrors `conversations_admin_manage`.
- **Real architecture blocker found while attempting to wire an actual
  webhook route** (documented, not routed around):
  `docs/ENTERPRISE_RUNTIME_CONTRACT.md` specifies `RuntimeContext.userId`
  as optional specifically so profiles without an authenticated end user
  can populate a context, but `packages/runtime`'s actual
  `runtimeContextSchema` requires it as a non-optional `z.string().uuid()`.
  An inbound WhatsApp webhook has no Supabase-authenticated user by
  definition, so it cannot construct a valid `RuntimeContext` and cannot
  call `createRuntime()`'s `run()` — the Conversation Runtime profile
  `docs/ENTERPRISE_RUNTIME_CONTRACT.md` itself specifies is, as written,
  unreachable through the one pipeline every component is required to use.
  `packages/runtime` is frozen platform (`IMPLEMENTATION.md`'s Platform
  Freeze Gate); silently loosening the schema or hand-rolling a parallel
  pipeline that only claims equivalent obligations are both exactly the
  kind of shortcut this project's working rules exist to prevent. Recorded
  as a new P1 item 15 sub-finding requiring an accepted ADR before route
  wiring can proceed — not decided unilaterally here, since it changes
  frozen platform contract, the same posture taken for every other
  genuine architecture decision this pass (the `generics` table, "begin
  Wave 3" itself) surfaced to the user rather than assumed.
- Static certification tests: 2 new cases in
  `packages/runtime/src/migration.test.ts`, 3 new cases in
  `packages/runtime/src/wave3-rls.test.ts`.

`npm run check` (196 tests, up from 175) and `npm run build` (all 8
workspaces) both pass clean after this pass. Still no route depends on
`@medlink/whatsapp` or `@medlink/conversation` — both remain additive,
tested, unwired packages pending the ADR above.

## Wave 3 continues — Supabase-backed Conversation Engine adapters, and ADR 0004 drafted

- **`apps/web/lib/conversation-store.ts`**: `SupabaseConversationRepository`,
  `SupabaseMessageStore`, `SupabaseConversationEventLog` implementing
  `packages/conversation`'s three persistence ports against migration
  `202607290012`'s tables — the same "adapter lives in the consuming app,
  not the domain package" pattern `apps/admin/lib/medicine-repository.ts`
  established for Wave 2. Unlike that file's `toBrandMedicine` (which
  `safeParse`s and returns `null` for a row outside a vocabulary the
  package doesn't control), this schema was written to match
  `packages/conversation`'s domain model exactly, so the mappers here
  `.parse()` (throw) instead — a row that fails is a real bug, not an
  honest external-data gap. 5 new tests for the pure mapper functions
  (`toConversation`/`toConversationMessage`/`toConversationEvent`); the
  class methods themselves need a live Supabase instance, same precedent
  `SupabaseMedicineCatalogReader` set.
- **`docs/adr/0004-conversation-runtime-webhook-identity.md`** (drafted,
  status **Proposed**, not self-accepted): resolves the `RuntimeContext
  .userId` finding from the prior pass. Three options considered — make
  `userId` genuinely optional (most invasive, touches every existing route
  and RPC), a well-known system identity (recommended: no existing Wave
  1/2 code changes, `userId` stays required and always populated), or a
  distinct non-`createRuntime()` lifecycle for Conversation Runtime (most
  honest, but exactly what the runtime contract forbids without amending
  the contract itself). Also flags that ADR 0001's "service-role access is
  not used by request handlers" needs a narrow, explicit exception for
  this one profile's already-scoped service-role-only writes — not
  violated silently, named. Left unaccepted deliberately: this changes
  frozen platform contract, the same posture taken for every other
  architecture decision this session (the `generics` table, "begin Wave
  3") — propose with a clear recommendation, don't self-approve.

`npm run check` (201 tests, up from 196) and `npm run build` (all 8
workspaces) both pass clean after this pass.

## Merge conflict resolved, then Wave 3 continues into Batch 3.2 groundwork

A push landed on the base branch (`agent/track-a-platform-foundation`,
"harden reservation and review contracts") after this PR opened, putting
it in a conflicted state. Resolved by merging the base branch in: two
textual conflicts kept this branch's already-tested versions (an inlined
Zod schema that breaks the Next.js build vs. this branch's sibling
`schema.ts`; an untested raw fetch vs. this branch's tested `decide()`
client). One semantic conflict the file-level merge didn't catch: the
incoming migration defined a second, 7-parameter `reserve_inventory`
overload nothing calls and that skips the runtime-evidence commit this
branch's 11-parameter version makes — added
`202607290014_retire_legacy_reserve_inventory_overload.sql` to drop it
rather than leave two implementations of the same operation to diverge.
204 tests, all 8 workspaces building, after the merge.

With CI green and no review comments on the merged state, continued into
Batch 3.2 (Workflow Orchestrator) — unblocked by the ADR 0004 question,
since it needs no route or `RuntimeContext`:

- **`packages/workflows/src/service.ts`**: `WorkflowInstance` now carries
  a `context`; a `WorkflowStep.execute` may return a context patch the
  store merges in atomically with marking the step complete (the same
  call, not two, so a crash between them can't leave the two
  inconsistent). Backward compatible — a step returning `void` (the only
  kind that existed before this pass) still works.
- **`packages/workflows/src/definitions.ts`**: a structural step-name
  sequence for all 15 canonical workflows, grounded in the DB state
  machines already built this session (`mar_status`, `prescription_status`,
  `extraction_status`) and `docs/release-scope.md`'s Wave 3 scope list —
  not invented. This is "canonical definitions" at the structural level
  RC1_BACKLOG item 16 asks for; most steps don't have an executable
  implementation yet.
- **`packages/workflows/src/medicine-search.ts`**: the first (and only,
  this pass) canonical workflow step with a real implementation —
  WF-005's `search_catalog` step wraps `packages/search`'s
  `MedicineSearchService`, reading `term`/`types`/`limit` from the
  workflow's context and returning the result page as its own context
  patch. Depends on `@medlink/search` directly rather than a further HTTP
  hop through a "versioned Experience API" (ADR 0003's diagram) — an
  acknowledged interim shortcut for this RC1 monorepo, mirroring
  `apps/admin`'s own `GET /api/v1/search` route, which already calls
  `packages/search` directly with no extra hop.
- 6 new tests (`service.test.ts` expanded from 1 to 4 properly-formatted
  cases; `definitions.test.ts`; `medicine-search.test.ts`).

Not built this pass, deliberately: a persisted `WorkflowStore` (only an
in-memory test fake exists), a `WorkflowInvoker` adapter wiring
`packages/conversation`'s port to this package, and executable steps for
the other 14 workflows. Each needs either a schema decision (workflow
instance persistence) or domain wiring this session hasn't done yet
(clinical review, inventory discovery, reservation, pickup, delivery) —
right-sized as separate follow-up work, not folded in to keep this pass's
diff reviewable against a single backlog item.

`npm run check` (213 tests, up from 204) and `npm run build` (all 8
workspaces) both pass clean after this pass.

## Batch 3.2 continues: durable store, WorkflowInvoker wiring, a second executable workflow, and a MAR/Reservation vocabulary audit

Four more increments toward Batch 3.2, still unblocked by ADR 0004:

- **Fixed a real multi-tenant correctness gap found while building the
  persisted store**: `WorkflowStore.findByKey(key)` took only the
  idempotency key, not the tenant -- fine for the single-run in-memory
  test fake, but a real persisted store needs both, or two different
  organizations reusing the same key string (plausible if a key derives
  from an external message id) could resolve to each other's workflow
  instance. Changed the port to `findByKey(tenantId, key)` and
  `WorkflowService.run()` to pass both, before any persisted
  implementation existed to paper over it.
- **Migration `202607290015_workflow_instances.sql`** and
  **`apps/web/lib/workflow-store.ts`**'s `SupabaseWorkflowStore`: real
  persistence for `packages/workflows`, closing the "durable" half of
  RC1_BACKLOG item 16. RLS mirrors `conversations` (admin-scoped read/
  manage) since the caller identity driving a workflow run has the same
  open question ADR 0004 raises for conversations.
- **`apps/web/lib/workflow-invoker.ts`**'s `WorkflowOrchestratorInvoker`:
  adapts `WorkflowService` to `packages/conversation`'s `WorkflowInvoker`
  port -- the actual wire ADR 0003's diagram draws between the
  Conversation Engine and Workflow Orchestrator. Runs `medicine_search`
  for real; throws `UnsupportedWorkflowTypeError` for any other classified
  intent rather than succeeding silently with no work done, since only one
  canonical workflow has executable steps so far.
- **`packages/workflows/src/clinical-review.ts`**: WF-007 Clinical
  Review's real executable step, the second (after WF-005). Wraps
  `packages/clinical`'s `ClinicalValidationService.validate()`. Since
  `ClinicalValidationInput` has no zod schema of its own (a plain TS
  interface, unlike `packages/medicine`'s models), added a runtime type
  guard rather than casting an untyped `jsonb` context value directly --
  a malformed or missing input skips validation and reports why, instead
  of passing bad data to the domain service or throwing.
- **MAR/Reservation state vocabulary audit** (RC1_BACKLOG item 18): every
  Wave 2/3-owned consumer (`toMar`, the review-decision contract test)
  passes the real DB enums (`mar_status`, `reservation_status`) through
  honestly -- no further fix needed there. Found and documented, not
  fixed (Wave 4, Wave Isolation): `apps/pharmacy/app/reservations/page.tsx`
  has never worked -- it bypasses its own cross-origin API client for a
  same-origin fetch that 404s locally, PATCHes a `"declined"` status the
  `reservation_status` enum has never had, and no
  `GET`/`PATCH /api/v1/reservations[/{id}]` route exists anywhere in the
  repo regardless. Also confirmed `packages/reservations`'s own
  (`active`/`expired`/`cancelled`/`fulfilled`) vocabulary mismatch against
  the DB enum is dead-code drift, not a live bug -- the package has zero
  real callers anywhere in the repository.

`npm run check` (226 tests, up from 213) and `npm run build` (all 8
workspaces) both pass clean after this round.

## MAR creation made atomic, event outbox investigated, WF-006 added

Investigating `createMar()` while looking for a third canonical workflow to
back with a real step (after WF-005 and WF-007) found it was still exactly
the gap `docs/audit/RC1_BACKLOG.md`'s item 3 (S01.8) named and deliberately
deferred: a raw single-table insert with no runtime evidence commit at
all, unlike every atomic RPC built earlier this session.

- **Migration `202607290016_create_mar.sql`**: `create_mar` commits the
  MAR row and its platform runtime evidence in one transaction, following
  the established pattern exactly. The MAR *domain* audit trail was
  already atomic -- `enforce_and_audit_mar_state()` (migration
  202607270003) inserts a `MAR.Created` `mar_audit_events` row via a
  trigger on the same insert -- so this RPC's job was narrower than
  `create_medicine_record`'s: business insert plus the platform evidence
  commit that trigger doesn't make. Idempotent replay uses
  `mar_audit_events_idempotency_idx`'s existing unique
  `(organization_id, idempotency_key)` constraint on the `MAR.Created`
  event, since `medication_access_requests.transition_idempotency_key`
  gets overwritten on every later state transition and can't serve as a
  creation-time dedup key.
- **`apps/patient/lib/application.ts`**'s `createMar()` now takes the full
  `RuntimeContext` (matching `reserve()`'s established shape) and calls
  the RPC instead of a raw insert; the route passes it through.
- **`packages/workflows/src/mar-creation.ts`**: WF-006's real executable
  step, the third canonical workflow backed by an actual call. Unlike
  WF-005/WF-007 (which wrap real domain packages), MAR creation has no
  portable domain package to wrap, so this defines a `MarCreator` port
  instead; `apps/web/lib/mar-creator.ts`'s `SupabaseMarCreator` is the
  concrete implementation, calling `create_mar` directly. Noted honestly
  rather than solved: a workflow-invoked creation has no HTTP request of
  its own to derive correlation/request identifiers from, and
  `packages/conversation`'s `InboundMessageInput` doesn't propagate one
  yet either -- `SupabaseMarCreator` generates a fresh request id and uses
  the idempotency key as the correlation id, tagged with a `"workflow"`
  channel so this origin stays distinguishable in
  `governance_audit_events`.
- **RC1_BACKLOG item 17 (general event outbox and consumers) investigated
  and documented, not built**: `runtime_outbox_events` (migration
  202607270006) already is the general transactional domain-event
  outbox and is in real, transactional use by every atomic RPC this
  session has built. Its schema is clearly designed for a claim-based
  Background Runtime worker (`status`/`locked_at`/`locked_by`/
  `published_at`/`retry_count`/`last_error_code`), but zero consumers
  exist anywhere in the repository -- the only other reference to the
  table is a read-only health check. Not built this pass: a claim/
  publish/fail RPC set would need to be `service_role`-only (unlike every
  other RPC this session has built for authenticated end users) to avoid
  a real cross-tenant security bug -- an `authenticated`-callable claim
  function could lock or read another tenant's outbox rows -- and even a
  correctly scoped claim mechanism has no real consumer to dispatch to
  yet, since "what does `mar.created` actually trigger downstream"
  requires selecting real integrations, the same class of undecided
  product question as the still-unselected OCR provider.

`npm run check` (232 tests, up from 226) and `npm run build` (all 8
workspaces) both pass clean after this round.

## Clinical review decision made atomic; three more canonical workflows get real steps

Five more increments, closing out most of the remaining low-risk Batch 3.2
ground before route wiring (blocked on ADR 0004) becomes the limiting
factor:

- **Migration `202607290017_decide_clinical_review.sql`**: closes the
  other S01.8 gap named alongside MAR creation. The old
  `AccessApplication.decideReview()` was a raw update guarded by
  `.eq("decision", "pending")`, which had its own latent bug beyond
  non-atomicity: a repeated call with the same decision (a client retry
  after a dropped response) matched zero rows once the review left
  `pending` and errored via `.single()` instead of replaying safely. The
  new RPC treats the decision itself as the idempotency signal -- same
  actor, same decision, same recommendation on an already-decided review
  returns the existing row; anything else (a different decision, a
  different actor) still raises, since that's a real conflict, not a
  replay. `clinical_reviews` has no per-decision idempotency-key column of
  its own to key a client-supplied key on, so this doesn't add one.
- **Three more canonical workflows get a real executable step**,
  bringing the total to six of fifteen:
  - **WF-004 Prescription Parsing** (`prescription-parsing.ts`) wraps
    `packages/prescription`'s `PrescriptionParser` directly -- like
    WF-005, it needed no new port, since the parser already depends on
    its own repository/reader/audit ports the caller supplies. A
    parser-level failure propagates rather than being swallowed as a
    skipped step, since a failed extraction is a real failure to surface,
    not a missing-input gap.
  - **WF-007 Clinical Review** gets a second step, `pharmacist_review`
    (alongside the existing `run_clinical_validation`), backed by the new
    `decide_clinical_review` RPC via a `ClinicalReviewDecider` port. Never
    auto-decides: the decision value must already be present in the
    workflow context, made by a human pharmacist through whatever channel
    captured it -- the step only records it atomically.
  - **WF-009 Reservation** (`reservation.ts`) wraps the existing
    `reserve_inventory` RPC (migration 010, already built in an earlier
    pass) via a new `ReservationCreator` port -- the domain logic already
    existed, it just wasn't callable from the Workflow Orchestrator yet.
  - Each new port's concrete Supabase-backed implementation
    (`apps/web/lib/mar-creator.ts`, `clinical-review-decider.ts`,
    `reservation-creator.ts`) follows the same documented pattern: a
    workflow-invoked call has no HTTP request of its own to derive
    correlation/request identifiers from, so each generates a fresh
    request id and uses a stable, deterministic value as the correlation/
    idempotency key, tagged with a `"workflow"` channel.
- 14 new tests across the five new/extended step files.

`npm run check` (246 tests, up from 232) and `npm run build` (all 8
workspaces) both pass clean after this round.

## Two more canonical workflows get real steps; a drift-detection test

Closing out the remaining low-risk Batch 3.2 ground unblocked by ADR 0004:

- **WF-008 Inventory Discovery** (`inventory-discovery.ts`) gets a real
  `search_inventory` step via a new `InventoryFinder` port. Unlike
  WF-006/WF-007/WF-009 (backed by an atomic RPC), this is a read-only
  query -- `apps/web/lib/inventory-finder.ts`'s `SupabaseInventoryFinder`
  reimplements the same filtered `inventory_batches` query
  `AccessApplication.inventory()` already runs, rather than sharing it,
  since the duplication risk on a read path is lower than a mutation would
  carry and consolidating it is a separate cleanup.
- **WF-003 Prescription Upload** (`prescription-upload.ts`) gets a real
  `store_prescription_record` step via a new `PrescriptionUploader` port,
  backed by the atomic `create_prescription_record` RPC (migration 008) --
  proven since Wave 2 from `apps/admin`'s `PrescriptionApplication.create()`,
  but never callable from the Workflow Orchestrator or a patient-facing
  upload flow before now.
- **A drift-detection regression test** in `definitions.test.ts`:
  constructs every one of the eight real `WorkflowStep`s built across this
  and prior passes (with throwaway port dependencies -- only `.name` is
  read) and asserts each one's name actually appears in its canonical
  workflow's structural step list in `definitions.ts`. Catches the exact
  class of bug a silent rename in either file would cause, which the
  existing "does every workflow have steps" test couldn't.

Seven of fifteen canonical workflows now have at least one real executable
step (eight steps total): WF-003, WF-004, WF-005, WF-006, WF-007 (x2),
WF-008, WF-009. The remaining eight (WF-001, WF-002, WF-010 through
WF-015) have no existing atomic RPC or domain service to wrap -- building
them means new business logic, not wiring, a different-shaped and larger
task deliberately left for a dedicated pass rather than folded in here.

`npm run check` (253 tests, up from 246) and `npm run build` (all 8
workspaces) both pass clean after this round.
