# RC1 Certification Closure — Gates 1–5

Date: 2026-07-29

## Gate 1 — CI and workspace builds

- CI now runs lint, typecheck, tests, coverage, every workspace build, and every
  workspace typecheck.
- All eight Next.js workspaces build successfully locally: admin, dashboard,
  developer, patient, pharmacist, pharmacy, provider, and web.
- Immutable CI evidence becomes available when these changes run on GitHub.

## Gate 2 — Migration apply

- CI starts an isolated Supabase stack, performs a clean database reset, and
  stops the stack even after failure.
- Local execution was attempted but Docker Desktop's Linux engine was not
  running, so local apply evidence remains pending.
- Provider enum creation is isolated from the migration that consumes the enum
  value, preserving PostgreSQL commit-boundary requirements.

## Gate 3 — Tenant RLS matrix

- The automated matrix discovers every table containing `organization_id`.
- Every discovered table must enable RLS.
- User-accessible tables must define an authenticated policy.
- Five internal queue/credential tables are asserted to have no authenticated
  policy and therefore deny direct access by default.

## Gate 4 — API and event contracts

- Professional operations have unique method/path pairs and remain under
  `/api/v1`.
- Domain-event names are unique and explicitly end in `.v1`.
- Required event fields are validated before publication.

## Gate 5 — Canonical workflows

- WF-001 through WF-015 each execute through the durable workflow service and
  assert completion and persisted step evidence.
- Existing focused tests continue to cover retry, dead-letter, compensation,
  handoff, replay, recovery, ordering, and stale concurrency behavior.

## Status

Source certification: **PASS**.

Immutable CI and isolated migration certification: **PASS** in GitHub Actions
run 20 for commit `b8ad95b5947233431b5265cdd575c298fe443f0b`.

Hosted migration and the eight-probe anonymous RLS matrix: **PASS** on
2026-07-30. The matrix also passes as the enabled `live-database` job in GitHub
Actions run 27, rerun attempt 2. Broader authenticated cross-tenant fixtures
remain part of environment certification.
