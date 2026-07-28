# Wave 3 certification — Medication Access Core

The MVP implements prescription → MAR → pharmacist review → inventory search →
match → reservation with tenant-scoped APIs and database enforcement.

## Invariants

- MAR transitions use a legal state graph, optimistic concurrency, idempotency,
  and append-only audit events.
- Only a licensed human pharmacist can complete clinical review.
- Inventory locks are atomic and compensated when reservation creation fails.
- Expired and quarantined batches cannot be newly reserved.
- Reservation expiry releases stock safely and idempotently.

## Verification

- [x] Domain unit tests
- [x] Independent patient, pharmacy, and pharmacist builds
- [x] Versioned APIs
- [x] RLS migration and static invariants
- [ ] Runtime migration and integration tests (requires Docker/PostgreSQL)
