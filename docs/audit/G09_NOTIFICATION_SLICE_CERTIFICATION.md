# G09 Minimum Notification Slice Certification

Date: 2026-08-04. Scope: the minimum G09 slice `FINAL_GO_NO_GO.md` itself
scoped as one of four items closable without inventing new architecture:
*"one real `NotificationChannel` (WhatsApp, since `GraphApiWhatsAppSender`
already exists and is tested) plus wiring `OutboxDispatcher` to at least
one real event."* This is the first genuinely pilot-blocking gap closed
since the AI Platform program (Alice/Atlas/Clara, PRs #12-#16) started --
chosen explicitly over further agent capability, per this session's
"Finish Clara, then the minimal G09 slice" decision.

## What was actually missing, confirmed before building

- `packages/workflows`' `OutboxDispatcher`/`OutboxStore`/`EventConsumer`
  already existed as interfaces, unused by any implementation.
- `runtime_outbox_events` (migration 202607270006) was already populated
  by every use case via `record_runtime_evidence()`, but nothing ever
  claimed a row off it.
- `packages/notifications`' `NotificationChannel`/`NotificationService`
  already existed as interfaces, with zero implementations anywhere in the
  repository.
- `packages/whatsapp`'s `GraphApiWhatsAppSender` was real, tested, and
  never once instantiated outside its own test file (confirmed by grep).
- The `notifications`/`notification_outbox`/`notification_delivery_attempts`
  schema (migration 202607270004, Wave 4) already existed with RLS and a
  documented "worker-only through the service role" convention, but no
  code ever wrote to or read from it.

Every piece this pass builds is therefore an adapter for an interface that
already existed, or a small, named widening of one -- consistent with
`FINAL_GO_NO_GO.md`'s own framing that this item is "wiring, not new
capability."

## What was built

**One real event.** `packages/api/src/index.ts`'s `runApi()` already
commits a generic `runtime.operation.completed` event for every operation.
Its payload gained one field, `actorId: entry.context.userId` -- already
computed at that call site for `target_actor_id`, just not previously
available to any outbox consumer. This is the only change to the shared
API pipeline; every other operation's behavior is unaffected.

**One real claim path.** `claim_runtime_outbox_events(worker, limit)`
(migration `202608040001`) is the only new database function: an atomic,
`FOR UPDATE SKIP LOCKED` claim, `SECURITY DEFINER`, granted to
`service_role` only. `published()`/`retry()`/`deadLetter()` needed no new
functions -- they're plain single-row updates on a row the worker already
exclusively holds, the same read-then-write style
`apps/web/lib/workflow-store.ts`'s `markStep()` already uses.

**One real `NotificationChannel`.** `WhatsAppNotificationChannel`
(`apps/patient/lib/notification-outbox.ts`) wraps `GraphApiWhatsAppSender`
with no new transport code -- just the mapping from the generic
`Notification` shape to `WhatsAppMessageSend` and a recipient resolver.
That resolver (`toSupabaseWhatsAppRecipientResolver`) needed no schema
change: `conversation_channel_bindings` already maps an organization to
its WhatsApp `phoneNumberId` (the inbound webhook's own lookup, reversed),
and `conversations` already carries a patient's own WhatsApp number as
`channel_identity`.

**One real consumer.** `ReservationConfirmedNotificationConsumer` is
registered for the shared `runtime.operation.completed` event type. Since
every operation shares that type, it inspects `payload.operation` and acts
only on `reservations.create`; every other operation's event is a silent,
successful no-op (the dispatcher marks it published, not retried).

**Idempotency, not a second dispatch mechanism.** `notifications` and
`notification_delivery_attempts` are used as `NotificationStore`'s durable
idempotency/evidence record. `notification_outbox` -- the table that would
give this its *own* claim/retry bookkeeping -- is deliberately left
unpopulated: using it alongside `runtime_outbox_events`/`OutboxDispatcher`
would be two competing dispatch mechanisms for the same concern, the same
kind of duplication this session already resolved once by retiring the
orphaned `medicine-match` agent in Atlas's pass.

## A real interface gap found while wiring, fixed narrowly

`NotificationStore.find(key)`/`record(key, result)` could not be
implemented durably: `record()` never received the original `Notification`
message, so a real store had nothing to persist a row from beyond
`{providerId}`; `find()` never received tenant scope either. Both were
widened -- `find(key, message)`, `record(key, message, result)` -- fixing
a second, more serious defect the first widening alone would have left: a
`NotificationStore` fixed to one `organizationId` at construction would
misfile a second tenant's notification under the first's, since a single
`OutboxDispatcher.dispatch()` pass can claim rows across tenants (the
worker isn't tenant-scoped, unlike every other client in this codebase).
`SupabaseNotificationStore` scopes every call by `message.tenantId`
instead. The one existing test in `packages/notifications` was updated to
the new signature; no other implementation existed yet to break.

## The one deliberate architectural tradeoff

**There is no scheduler in this environment.** Building one is exactly the
full Integration/Notification Platform superprompt this session's earlier
`AskUserQuestion` answer explicitly declined in favor of this minimal
slice. Dispatch is instead piggybacked on the reservations route: right
after `POST /api/v1/reservations` commits, the route makes one bounded,
best-effort `dispatcher.dispatch(worker, 5)` call before responding. A
WhatsApp outage, missing credential, or notification-store failure there
is caught and swallowed -- it must never turn an already-committed
reservation into a failed response. The practical consequence: a pending
outbox event is only picked up on the *next* reservation request from any
patient in the same environment, not on a fixed schedule. This is real and
named, not hidden -- a production rollout would replace that call site
with an actual scheduled worker calling the same `dispatch()` method.

## What was deliberately not built

- **Not full G09.** No email or SMS channel, no template beyond
  `reservation_confirmed`, no patient-name or medicine-name personalization
  (the generic `runtime.operation.completed` payload doesn't carry either,
  and widening it further was out of scope for this pass -- named as
  follow-up, not silently worked around). `FINAL_GO_NO_GO.md` explicitly
  scoped this down: "One WhatsApp-only slice is sufficient for a pilot."
- **No scheduler/cron worker** -- see above.
- **`runtime_dead_letters` is not populated.** `deadLetter()` flags the
  outbox row `dead_letter` but writes no corresponding audit-log row,
  though the table exists for exactly that. A genuinely dead-lettered
  event (four failed WhatsApp deliveries) is visible by status only, not
  by a dedicated evidence row.
- **`notification_outbox`/`notification_delivery_attempts`' own
  claim/retry columns are not used as a dispatch queue** -- see above.
  `notification_delivery_attempts` is still written, but only as an
  evidence log, one row per successful send.
- **WhatsApp→WF-003 chaining** (a prescription photo sent over WhatsApp
  reaching the upload workflow) remains the separate, already-known gap
  named in `FINAL_GO_NO_GO.md`; this pass does not touch it.

## Test evidence

17 new tests in `apps/patient/lib/notification-outbox.test.ts` covering
`SupabaseOutboxStore` (claim mapping, published/retry/deadLetter,
infrastructure-error propagation), `WhatsAppNotificationChannel` (unknown
template, unbound recipient, happy path), `toSupabaseWhatsAppRecipientResolver`
(no binding, no conversation, both present), `SupabaseNotificationStore`
(tenant-scoped find/record), and `ReservationConfirmedNotificationConsumer`
(no-op on wrong operation, no-op on missing actor, real send on match). 3
new tests in `packages/runtime/src/migration.test.ts` for the new
migration. 2 new tests in `packages/notifications/src/service.test.ts` for
the widened `NotificationStore` contract. Full repository `npm run check`:
708 passed, 8 skipped, 0 failures (up from 686 before this pass). `npm run
build`: all apps build cleanly, including `apps/patient` with neither
`WHATSAPP_ACCESS_TOKEN` nor `SUPABASE_SERVICE_ROLE_KEY` configured --
confirming the lazy, per-request construction pattern (`getHandlers()` in
`apps/web`'s webhook route; `dispatchPendingReservationNotifications()`
here) holds for this slice too.

## Relationship to RC1 pilot readiness

This is the first item in this session's post-RC1-certification work that
directly narrows a named pilot-blocking gap rather than adding orthogonal
AI-platform capability. `GO_NO_GO_SUMMARY.md` names four closable items;
this closes one (item 3, the minimum G09 slice) for a single channel,
single event, single template. The other three -- a live test environment,
WhatsApp→WF-003 chaining, and credential rotation -- remain untouched.

**The RC1 pilot verdict is unchanged: GO WITH CONDITIONS for a controlled
pilot, NO-GO for General Availability.** Closing one of four named items
narrows the gap; it does not, by itself, change the verdict, which
`FINAL_GO_NO_GO.md` conditions on all four together plus the GA-specific
items `GA_DECISION.md` separately owns.
