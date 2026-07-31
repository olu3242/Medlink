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
