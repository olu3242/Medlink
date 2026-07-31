# [HISTORICAL / PRE-CDA] Wave 3 certification — Medication Access Core

> **This document predates the Conversation-Driven Architecture pivot and
> does not describe the current Wave 3.** `docs/release-scope.md` and
> `IMPLEMENTATION.md` are authoritative: the current Wave 3 is "Conversation
> Platform (Primary MVP)" — the Conversation Engine, WhatsApp adapter, and
> Workflow Orchestrator — none of which existed when this file was written.
> The MAR/reservation/clinical-review invariants and checklist below still
> describe real, still-relevant schema-level guarantees (see migrations
> 202607270003 and 202607290010), so this file is kept rather than deleted,
> but do not treat its title or checklist as current Wave 3 certification
> status. Closes `docs/audit/RC1_BACKLOG.md` P0 item 5 ("mark old wave
> certification documents as historical/pre-CDA").

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
