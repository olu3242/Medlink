# ADR 0001: Platform foundation

## Status

Accepted.

## Decision

MedLink uses an npm workspace monorepo with a Next.js experience API and small,
framework-independent packages for platform policy, database contracts,
observability, and UI primitives.

Supabase Auth establishes identity. Organization membership establishes tenant
context and role. PostgreSQL row-level security remains the final tenant
isolation boundary; service-role access is not used by request handlers.

## Consequences

All later engines consume the same request context and authorization contracts.
Tenant-scoped tables must reference `organizations` and ship with RLS policies.

## Amendment (ADR 0004)

"Service-role access is not used by request handlers" gets one narrow,
explicit exception: the Conversation Runtime's WhatsApp webhook entry point
(`apps/web/app/api/whatsapp/webhook/route.ts`), and only for the specific
writes migration `202607290012` already scoped to service-role-only
(`conversation_messages`, `conversation_events`). A webhook delivery has no
Supabase-authenticated caller RLS can evaluate — it is authenticated by
`packages/whatsapp`'s HMAC signature verification instead, per ADR 0004. No
other request handler gains this exception; every other tenant-scoped write
continues to go through an authenticated session and RLS exactly as this ADR
originally specified.
