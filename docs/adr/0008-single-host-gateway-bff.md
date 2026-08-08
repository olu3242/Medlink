# ADR 0008: Single-Host Gateway/BFF for RC1

## Status

Accepted — 2026-08-01.

## Decision

RC1 deploys one browser-facing Next.js application at `app.medlink.com`.
`apps/web` is the Gateway/BFF and owns shared authentication refresh,
correlation, browser security policy, portal route groups, and `/api/v1/*`.
Patient, pharmacy, pharmacist, provider, admin, dashboard, and developer
experiences migrate into that deployment incrementally. Browsers use relative
gateway URLs and never call domain services or independently hosted portal APIs.

The gateway authenticates the session, but API authorization remains enforced
inside `runExperienceApi`/`runApi`. Tenant identity is resolved from the
authenticated user and verified organization membership; middleware MUST NOT
turn an untrusted tenant header into trusted context.

## Consequences

- Same-origin cookies remove RC1 CORS and cross-origin token propagation.
- One middleware refreshes sessions and supplies correlation IDs.
- Existing experience contract IDs, permissions, workflows, RPCs, audit, and
  event contracts remain authoritative.
- Portal applications remain temporarily as migration sources, not independent
  RC1 deployment targets.
- A route is removed from its legacy app only after gateway contract and UI
  tests prove parity.
- Future service or micro-frontend separation occurs behind the gateway
  contract and requires a new ADR.

## Security decisions

- Supabase auth cookies remain `HttpOnly`, `Secure` in production, and
  `SameSite=Lax` under provider-supported settings.
- State-changing same-origin requests are checked using Fetch Metadata and
  Origin/Host where available; webhook/provider routes use their own signature
  controls.
- JWTs are not stored by portal application code or exposed through client
  state.
- Correlation IDs are generated at the boundary and treated as tracing input,
  not authorization data.

## Migration order

1. Gateway middleware and shared API client.
2. Patient read paths and prescription/MAR creation.
3. Reservation creation and pharmacy fulfillment decision.
4. Pharmacist review.
5. Admin/provider/dashboard/developer experiences.
6. Realtime projection invalidation and full live certification.
