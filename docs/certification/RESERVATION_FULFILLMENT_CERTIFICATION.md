# Reservation and Fulfillment Workflow Certification

## Verdict

**PARTIAL — canonical creation and pharmacy decision paths pass source, contract,
migration-invariant, and build gates. Live PostgreSQL execution is not
certified. Ready, collection, expiry, notification delivery, and realtime UI
convergence remain open.**

## Implemented scope

- One canonical reservation command with matched MAR, pharmacy location,
  inventory batch, quantity, expiry, and header idempotency key.
- Runtime-derived patient/requester, organization/tenant, correlation, channel,
  and authorization context.
- Inventory search output exposes canonical batch/location/medicine identity
  and current allocatable quantity.
- Gateway UI requires a matched MAR and sends the complete command.
- Stable client idempotency keys survive ambiguous failures and retries.
- Registered `pharmacy.reservation.decide` operation.
- Atomic `decide_reservation` RPC for confirmation or decline.
- Decline maps to canonical cancellation and releases the inventory lock.
- Immutable fulfillment transition and runtime/outbox evidence are recorded in
  the decision transaction.
- Gateway pharmacy queue refreshes from backend state after decisions.

## Executed evidence — 2026-08-01

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Targeted domain/contract/migration tests | Pass — 101 tests |
| Full Vitest suite after architecture fix | Pass — 134 files, 592 tests |
| Live database suite | Not run — eight tests skipped; Docker engine unavailable |
| Gateway production build | Pass |
| Gateway reservation creation route | Present in build manifest |
| Gateway reservation decision route | Present in build manifest |
| Patient canonical reservation page | Present in build manifest |
| Pharmacy decision queue | Present in build manifest |

## State coverage

| Transition | Status |
| --- | --- |
| Matched MAR → pending reservation + active lock | Existing atomic RPC; source-tested |
| Pending → confirmed | Implemented; live DB evidence pending |
| Pending → cancelled + released lock | Implemented; live DB evidence pending |
| Confirmed → ready | Contract/domain abstraction exists; API/RPC binding missing |
| Ready → collected + consumed lock | Contract/domain abstraction exists; API/RPC binding missing |
| Open → expired + released lock | Existing domain concept; operational job/live evidence pending |

## Remaining certification gates

1. Start local/CI Postgres and execute migrations from zero.
2. Add live tests for role enforcement, cross-tenant denial, replay equivalence,
   conflicting-key rejection, concurrent decisions, rollback, and lock quantity.
3. Bind and certify `ready`, `collect`, and expiry commands atomically.
4. Schedule and verify notification outbox entries for each outcome.
5. Prove realtime UI convergence from committed outbox events.
6. Exercise reservation expiry and DLQ/recovery runbooks.

No production or RC1 certification may be inferred from this partial verdict.
