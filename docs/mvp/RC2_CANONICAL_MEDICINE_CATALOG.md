# RC2 Canonical Medicine Catalogue — Implementation Evidence

Date: 2026-07-30  
Branch: `rc2-development`  
Capability: `ML-CAP-005`  
Workflow: `ML-WF-007`

## Outcome

MedLink now has one canonical medicine ownership boundary. The existing
`medicines`, `active_ingredients`, aliases, registrations, and equivalences
tables were extended rather than duplicated. Administrator and patient
applications consume the same domain contract and Supabase repository.

## Implemented

- Strict canonical schemas for medicine details, ingredients, synonyms,
  regulatory registrations, status, versions, search results, and alternatives.
- Deterministic strength normalization and a governed dosage-form reference.
- Exact-first search across brand, generic, active ingredient, manufacturer,
  registration number, and synonym.
- Atomic create/update commands with idempotency, optimistic concurrency,
  outbox events, governance audit, and immutable catalogue version records.
- A duplicate merge command that validates clinical identity and active
  ingredients, locks both rows, migrates references, detects inventory
  collisions, retires the source, and records evidence.
- Alternatives that reference active medicines only and permanently require a
  pharmacist decision.
- Active-only patient projections and tightened RLS for registrations and
  equivalences.
- Administrator catalogue, ingredient creation, update, merge, and alternative
  APIs plus an accessible catalogue editor.
- Patient catalogue list, search, detail, registration, ingredient, and
  alternative views with an explicit no-auto-substitution warning.

## Validation evidence

- 43 focused catalogue, search, event-contract, and RBAC tests passed.
- 37 focused tests passed again after the atomic ingredient command and RLS
  hardening.
- Strict TypeScript passed for medicine, search, API, admin, and patient
  workspaces.
- Targeted ESLint passed with zero errors.
- Administrator production build passed and emitted all catalogue routes.
- Patient production build passed and emitted catalogue list/detail/API routes.
- Lockfile regeneration completed offline with zero reported dependency
  vulnerabilities.

## Unverified external evidence

The local Docker engine is not running, so the Supabase CLI cannot start or
inspect an isolated local database. Static migration invariants passed, but no
claim is made that migration `202607300019` or its RLS policies have executed
against PostgreSQL in this environment.

Promotion therefore requires:

1. Apply migrations `202607300017` through `202607300019` to an isolated RC2
   Supabase project.
2. Run authenticated platform-admin, patient, pharmacist, and cross-tenant
   allow/deny tests.
3. Prove idempotent replay, stale-version rejection, version evidence, merge
   reference migration, and rollback from a clean backup.
4. Confirm alternatives remain non-executable until the licensed pharmacist
   workflow approves a prescription-level decision.

Until that evidence is accepted, the phase is implementation-complete and
certification-pending.
