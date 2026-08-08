# Reservation Domain Audit

## Verdict

The atomic creation command is authoritative and substantially correct. The
client and professional fulfillment surfaces are not harmonized with it.
Reservation creation is therefore `PARTIAL`; pharmacy decision and subsequent
fulfillment are `MISSING` at the executable API/persistence boundary.

## Artifact inventory

| Layer | Artifact | Finding |
| --- | --- | --- |
| Legacy patient UI | `apps/patient/app/reserve/[inventoryId]/page.tsx` | Sends only `inventoryId`; incompatible and must be retired |
| Gateway search UI | `apps/web/app/(portals)/patient/search/page.tsx` | Has batch identity but does not select matched MAR or carry pharmacy location |
| API creation | `apps/patient/app/api/v1/reservations/route.ts` | Correct core fields, but idempotency appears in body while runtime also reads header |
| Application | `AccessApplication.reserve()` | Correctly delegates to the atomic RPC |
| Atomic RPC | `reserve_inventory` | Validates actor, tenant, matched MAR, batch/location, availability, quantity, expiry, replay payload; atomically inserts reservation/lock, transitions MAR, and records evidence |
| Tables | `reservations`, `inventory_locks` | Canonical status and lock invariants exist |
| Professional contract | `packages/api/src/professional.ts` | Defines `ready` and `collect`; no confirmation/decline decision |
| Pharmacy UI | `apps/pharmacy/app/reservations/page.tsx` | Sends legacy `confirmed`/`declined` directly to an unimplemented resource patch |
| Fulfillment domain | `FulfillmentCoordinator` | Defines reserve/ready/collect/compensate in memory-facing ports, not database/API binding |
| Persistence | `fulfillment_transitions` | Append-only evidence table exists; no atomic transition command uses it |
| Events | `packages/api/src/events.ts` | Created/ready/collected exist; confirmed/cancelled are absent |
| Notifications | notification domain/outbox | Infrastructure exists; no decision command schedules a reservation outcome notification |

## Canonical creation command

The public command contains `marId`, `pharmacyLocationId`,
`inventoryBatchId`, `quantity`, and `expiresAt`. Idempotency is the
`Idempotency-Key` header; actor, organization/tenant, requester, correlation,
channel, and locale come only from trusted runtime context. Medicine and patient
identity are derived and validated from the MAR/batch, preventing contradictory
client assertions.

## State machine

```text
matched MAR -> pending reservation + active lock -> confirmed
                                             |       |
                                             |       v
                                             |     ready -> collected + consumed lock
                                             v
                                          cancelled + released lock
pending/confirmed/ready -> expired + released lock
```

Confirmation and decline are pharmacy decisions. `ready` is not a synonym for
confirmation: it asserts that pickup preparation is complete. Collection
consumes the lock. Decline maps to the canonical terminal `cancelled` status
with an explicit reason; a new `declined` database state is unnecessary.

## Required closure

1. Use one header idempotency key and reject its absence.
2. Enrich inventory results with canonical batch/location/medicine identity.
3. Require selection of a matched MAR before reservation.
4. Add an atomic pharmacy decision RPC covering status, lock compensation,
   fulfillment transition, runtime evidence/outbox, and replay validation.
5. Register confirmed/cancelled event contracts and the decision operation.
6. Implement ready/collect RPC bindings after the decision gate.
7. Add live database tests for concurrency, replay, authorization, and rollback.

No compatibility endpoint or one-field payload is permitted.
