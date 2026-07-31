# ADR 0004: Conversation Runtime webhook identity

## Status

Proposed. Not yet accepted — this changes frozen platform contract
(`packages/runtime`, `docs/ENTERPRISE_RUNTIME_CONTRACT.md`) per
`IMPLEMENTATION.md`'s Platform Freeze Gate, which requires an accepted ADR
before such a change lands, not an engineering judgment call. Recorded in
`docs/audit/RC1_BACKLOG.md` P1 item 15 and `docs/audit/CERTIFICATION_GAP.md`
as the specific blocker on WhatsApp webhook route wiring.

## Context

`docs/ENTERPRISE_RUNTIME_CONTRACT.md` defines five runtime profiles sharing
one universal lifecycle and one `RuntimeContext`, and documents `userId` as
optional on that context (`userId?: string`) specifically so profiles
without an authenticated end user — Conversation Runtime's webhooks,
Background Runtime's workers — can still populate a valid context.

`packages/runtime`'s actual implementation does not match that document:
`runtimeContextSchema` requires `userId: z.string().uuid()` with no
`.optional()`. `createRuntime()`'s `run()` calls
`dependencies.authenticate(request)` to obtain `userId` before it will
construct a context at all.

An inbound WhatsApp webhook delivery has no Supabase-authenticated user —
Meta calls the webhook URL directly, authenticated only by an HMAC signature
over the raw body (`packages/whatsapp`'s `verifyWebhookSignature`, already
built and tested). There is no `userId` to authenticate. As written today,
the Conversation Runtime profile the contract document itself specifies
cannot be reached through `createRuntime()` — the one pipeline
`docs/ENTERPRISE_RUNTIME_CONTRACT.md` requires every component to use
("No component may create a custom execution pipeline or bypass a
mandatory stage").

This also intersects ADR 0001 (accepted): "service-role access is not used
by request handlers." That invariant assumes every request handler has an
authenticated caller RLS can evaluate. A webhook handler has none — this is
exactly why migration `202607290012`'s `conversation_messages` and
`conversation_events` tables were designed with no `authenticated` insert
policy at all, service-role-only by construction, mirroring the existing
`notification_outbox` precedent (migration `202607270004`). ADR 0001's
statement needs an explicit, narrow amendment to remain accurate, not a
silent violation.

## Options considered

1. **Make `userId` genuinely optional in `runtimeContextSchema`,
   matching the documented interface.** Every consumer of
   `context.userId` (audit records, `is_organization_member`-style RLS
   helpers that key off `auth.uid()`, any SECURITY DEFINER function that
   checks `target_actor_id`) would need to handle its absence. This is the
   most invasive option — it changes a type every existing Wave 1/2 route
   and RPC already depends on being present, for the benefit of a profile
   (Conversation Runtime) none of them use yet.

2. **Introduce a well-known system identity.** Provision one fixed
   `auth.users` row (e.g. `whatsapp-webhook@system.medlink.internal`) whose
   UUID is used as `context.userId` for every Conversation Runtime
   operation, authenticated not by a Supabase session but by
   `verifyWebhookSignature` succeeding. `runtimeContextSchema` stays
   unchanged (`userId` stays required and always populated). RLS policies
   that check `auth.uid()` still don't apply to service-role writes, but
   the audit trail gets a real, stable actor to attribute webhook-driven
   writes to instead of a null gap. Existing Wave 1/2 code paths are
   untouched.

3. **Give Conversation Runtime a distinct, smaller lifecycle rather than
   forcing it through `createRuntime()`.** Explicitly split "the universal
   lifecycle" into what a webhook can actually satisfy (verify
   authenticity, resolve tenant, validate, execute, persist, audit, emit
   telemetry) versus what it structurally cannot (RBAC authorization
   against a Supabase session, since there is no session). This is the
   most honest description of what's actually different about this
   profile, but it is also the change `docs/ENTERPRISE_RUNTIME_CONTRACT.md`
   most explicitly forbids ("No component may create a custom execution
   pipeline") unless the contract document itself is amended to define
   this as a certified, distinct pipeline rather than a bypass.

## Recommendation

Option 2. It resolves the contradiction with the least blast radius: no
existing Wave 1/2 RLS policy, RPC signature, or audit consumer changes,
because `userId` is always present and always a real UUID. It keeps
`docs/ENTERPRISE_RUNTIME_CONTRACT.md`'s "every operation carries one
immutable, validated context" invariant intact rather than punching a hole
in it. The system identity is provisioned once (a migration, not app code)
and referenced the same way `is_platform_admin()` already references
`organization_memberships` rows.

This still requires amending ADR 0001's "service-role access is not used by
request handlers" to a narrow, explicit exception: the Conversation Runtime
webhook entry point, and only for the specific writes migration
`202607290012` already scoped to service-role-only
(`conversation_messages`, `conversation_events`), authenticated by
`packages/whatsapp`'s signature verification instead of a Supabase session.
No other request handler gains this exception.

## Consequences if accepted

- A new migration provisions the system identity and documents it as the
  Conversation Runtime's `context.userId` source.
- `createRuntime()`'s `authenticate()` dependency gets a Conversation
  Runtime implementation that verifies the webhook signature instead of a
  Supabase session, then returns the system identity's `userId` plus the
  tenant resolved from `conversation_channel_bindings` (migration
  `202607290013`).
- ADR 0001 gets an explicit amendment note for the narrow service-role
  exception described above.
- Only after this is accepted can a WhatsApp webhook route be built that
  actually calls `createRuntime()`'s `run()`, keeping the "one pipeline"
  invariant intact instead of bypassing it.

## Consequences if rejected or deferred

The WhatsApp webhook route remains unbuilt. `packages/conversation` and
`packages/whatsapp` remain real, tested, but unwired packages — not wasted
work, since Batch 3.2 (Workflow Orchestrator) and any future channel both
need these same ports and adapters regardless of how webhook identity is
resolved.
