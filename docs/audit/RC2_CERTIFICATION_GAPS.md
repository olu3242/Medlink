# RC2 Certification Gaps

Date: 2026-07-31

## Current gates

| Gate | Result | Evidence / blocker |
| --- | --- | --- |
| Dependency tree | COMPLETE | `npm.cmd ls --depth=0` exits 0 |
| Lint | COMPLETE | `npm.cmd run lint` exits 0 |
| Strict TypeScript | COMPLETE | root typecheck exits 0 |
| Unit/contract/static workflow tests | COMPLETE | focused Batch 2 suite passes; final full-suite total pending checkpoint |
| Coverage threshold | IMPLEMENTING | final coverage run pending checkpoint |
| Eight application builds | IMPLEMENTING | final workspace build pending; pre-change baseline passed all apps |
| Migration source shape | PARTIAL | static migration/RLS suites through `021` pass |
| Migration apply/recovery | BLOCKED | Docker Desktop Linux engine unavailable |
| Authenticated RLS/tenant isolation | BLOCKED | no runnable isolated database identities in this process |
| Scanner provider | BLOCKED | endpoint/credentials unavailable |
| OCR/parser providers | BLOCKED | endpoints/credentials unavailable |
| WhatsApp provider | BLOCKED | no executable adapter route/configuration |
| Golden Path E2E | PARTIAL | source reaches pharmacist canonical resolution and inventory availability; stops before patient matching/reservation |
| External operational certification | BLOCKED | penetration, backup/restore, DR, production and human approvals are external |

## Source checkpoint

The two direct-persistence route defects found by the initial audit are fixed
behind application/repository boundaries. The focused architecture suite now
passes without weakening exclusions. Final repository-wide validation remains
mandatory before commit.

## Required live evidence

- Clean apply of migrations `202607300017` through `202607310021`.
- Authenticated platform-admin, tenant-admin, pharmacist, pharmacy staff,
  inventory manager and patient allow/deny cases using real memberships.
- Tenant A cannot read or mutate tenant B prescriptions, review evidence,
  inventory, locks, reservations, workflow, outbox or audit records.
- Service-role-only worker and expiry commands reject user-facing tokens.
- Concurrent stock/reservation attempts cannot over-reserve and replay is
  idempotent.
- Pharmacist approval cannot bypass canonical item resolution; clarification
  response history remains tenant/patient protected and requeues exactly one
  fresh review under idempotent replay.
- Scanner/OCR/parser timeout, malformed output, retry, fence and dead-letter
  behavior executes against configured providers.
- WhatsApp verification, duplicate/out-of-order input, media, consent, opt-out,
  delivery receipt, retry, dead-letter and human handoff execute against the
  approved provider environment.

## Certification rule

Static RLS discovery, mocked ports, filenames, documentation, and successful
builds are supporting evidence only. They cannot change a `BLOCKED` live gate
to `COMPLETE`.
