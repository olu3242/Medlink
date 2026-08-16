# MedLink Medication Access RC1 — Release Readiness

Canonical base: `main` @ `a008d41` (PR #27 merged). This branch (`feat/medication-access-rc1-browser-e2e`, PR #28) adds the scheduled notification worker, the reservation-expiry audit trail, and an outbox-claim-race proof on top of that base.

## Certified transaction foundation (do not redesign)

- **MERDP**: 9,008 products / 8,994 canonical medicines / 5,429 certified+published / 1,389 manufacturers / 11,707 relationships / 2,700 off-list evidence / 0 unsafe NRN merges. Diff vs `main` = 0 (verified this round; not re-acquired).
- **Medication transaction**: `reviewed → searching → matched → reserved`.
- **Reservation**: `pending → confirmed → ready → collected`, or `pending → cancelled`, or (this round) any of `pending/confirmed/ready → expired`.
- **Inventory lock**: `active → consumed`, `active → released` (cancel), `active → expired` (this round).
- **Pickup credential**: patient-issued, client-side generated (Web Crypto), hash-only persistence, tenant/patient isolated, non-rotating, consumed (hash nulled) on collection, never sent over WhatsApp/outbox/audit.
- **Notifications**: `reservation.{confirmed,cancelled,ready,collected}.v1`, tenant-scoped recipient resolution, durable outbox with retry/dead-letter, transaction-independent (failure never rolls back the domain transaction).
- **Live baseline**: 21/21 (PR #27) → 23 tests collected on this branch (+2: expiry proof, outbox-claim-race proof); pending live CI confirmation on the pushed commit.

## This round's changes

1. **Notification dispatch worker** (`POST /api/internal/notification-dispatch`, `apps/web`): closes the gap where dispatch only advanced opportunistically on reservation-route HTTP traffic. Reuses the exact bearer-token pattern already established by `/api/internal/inventory-expiry` and `/api/internal/clinical-pipeline`.
2. **Reservation expiry audit trail**: `release_expired_inventory_holds` already atomically expired overdue reservations/locks/MARs (`FOR UPDATE OF lock SKIP LOCKED`) — this was previously uncertified by any test. Added a `fulfillment_transitions` row per expiry (matching every other lifecycle RPC) and a live-DB proof.
3. **Outbox claim-race proof**: live test confirming two concurrent workers calling `claim_runtime_outbox_events` against the same eligible event never both own it.

## Authentication prerequisite: RESOLVED (PR #29)

`apps/patient`, `apps/pharmacist`, and `apps/pharmacy` each now extend `apps/web`'s own already-accepted magic-link pattern (self-contained sign-in/callback/logout, no cross-app cookie-domain sharing), rather than requiring a novel production auth-topology decision. Certified via real browser E2E (Playwright + Mailpit, real magic-link flow, no session bypass): patient/pharmacist/pharmacy auth, multi-persona (one identity, multiple memberships, ambiguous context fails closed), tenant isolation, RLS, and session security all PASS — 9/9 browser auth tests, live medication regression intact at 23/23. Full detail and the architectural chain: `docs/mvp-integration/AUTHENTICATION.md`.

Three previously-latent defects were found and fixed while certifying this: `requestDatabase()` was forcing an empty `Authorization` header for cookie-based sessions (silently downgrading every authenticated data query to Postgres role `anon`); several identity/clinical/pharmacy tables had RLS policies but no table-level `GRANT`; and the E2E harness's magic-link parsing/redirect-allowlisting needed to match GoTrue's actual verify-link shape and every app's real callback origin. See `docs/mvp-integration/AUTHENTICATION.md` for the invariants these established.

The remaining browser certification target is the **authenticated medication access golden loop**: Patient → Pharmacist → Patient match/reserve → Pharmacy confirm → Pharmacy ready → Patient pickup credential → Pharmacy collect, now that all three personas can authenticate for real. Not yet certified.

Local execution is separately constrained: Docker is unreachable in this sandbox, so live/browser suites only execute in CI — consistent with the whole program's established pattern.

## Observability: partial, one item deferred by design

Existing coverage (reused, not rebuilt): `/health/{live,ready,startup,details}`, `/runtime/{diagnostics,evidence,anomalies,certification}` — outbox reachability is one of the existing health check dimensions.

**Not added this round**: outbox backlog counts (pending/retrying/dead-letter) and worker last-run visibility. `runtime_outbox_events` has zero RLS policies, and `apps/web`'s own ADR-documented policy restricts service-role client construction to one exception (the WhatsApp webhook) — "no other request handler in this app may construct or use this client." Building cross-tenant backlog visibility safely needs a new admin-scoped SECURITY DEFINER RPC (a small, real schema decision), not a quick route using the service-role client. Deferred rather than rushed past that documented boundary.

## Security/privacy audit (this round)

Grepped changed and relevant runtime paths for hardcoded secrets, unsafe `NEXT_PUBLIC_*` exposure, plaintext-credential logging, disabled RLS, debug routes. Clean — no findings.

## Environment requirements (worker tokens)

- `MEDLINK_NOTIFICATION_WORKER_TOKEN` (≥32 chars) — new, for `/api/internal/notification-dispatch`.
- `MEDLINK_INVENTORY_WORKER_TOKEN`, `MEDLINK_CLINICAL_WORKER_TOKEN` — pre-existing siblings, same pattern.
- `WHATSAPP_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required by all three worker routes.

All three internal worker routes must be scheduled externally (this repository has no in-process cron); operations must configure a scheduler (e.g. platform cron) to POST each on a fixed cadence with its bearer token.

## Known limitations / post-RC1 backlog

- Authenticated medication access golden loop (Patient → Pharmacist → Pharmacy, browser E2E) not yet certified — the next slice, now unblocked by PR #29.
- Mailpit polling/event synchronization: 3/9 browser auth tests needed one CI retry from email-indexing timing; classified non-blocking test reliability debt (all passed within the configured retry policy). Target: zero retry-dependent browser passes.
- Outbox/expiry operational backlog visibility deferred pending an admin RPC decision.
- Expiry notification (`reservation.expired.v1`) not implemented — no consumer registered; flagged POST_RC1 rather than inventing a template.

## Program backlog (classified, not implemented here)

| Track | Scope |
|---|---|
| A | Medication Discovery — geo + brand/generic + pharmacy discovery |
| B | Payment E2E — `PAYMENT_REQUIRED → PAYMENT_CONFIRMED` insertion between confirmation and preparation; needs its own governed convergence, not a quiet RC1 addition |
| C | WhatsApp identity + persona runtime |
| D | Conversation ↔ Workflow convergence |
| E | Agent registry + router + governed execution |
| F | Workflow-mediated agent handoffs |
| G | Exception/recovery expansion |
| H | Named-agent admission |
| I | Governed learning/evaluation |
