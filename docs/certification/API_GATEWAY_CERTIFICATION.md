# RC1 API Gateway Certification

## Verdict

**PARTIAL — foundation and patient read slice pass source/build gates; live
runtime and full portal migration are not certified.**

## Implemented evidence

- ADR 0008 accepts `apps/web` as the single-host Gateway/BFF.
- Gateway route handlers own patient MAR, inventory, pharmacy, notification,
  reservation, and pharmacist review contract paths.
- `apps/web/lib/api/gateway-contract.ts` rejects absolute/cross-origin API paths.
- The server gateway client forwards cookie, bearer authorization, tenant hint,
  locale, and correlation ID while preserving explicitly supplied headers.
- The browser client uses relative paths, same-origin credentials, and timeout
  cancellation.
- Patient request list, search, timeline, and notification pages live under the
  `/patient/*` gateway route group.

## Executed checks — 2026-08-01

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Pass |
| Gateway contract tests | Pass — 3/3 |
| `npm.cmd run build --workspace @medlink/web` | Pass |
| Gateway API routes in build manifest | Pass — nine migrated `/api/v1/*` routes |
| Gateway patient routes in build manifest | Pass — four dynamic pages |
| Live authenticated database path | Not executed |
| Cross-role tenant/RBAC browser test | Not executed |
| Realtime convergence | Not implemented |

## Open blockers

1. Reservation creation and pharmacy decision are source/build integrated but
   lack live PostgreSQL and authenticated browser evidence.
2. Ready, collect, expiry, notification, and realtime bindings remain open.
3. Pharmacist, admin, provider, dashboard, and developer pages remain
   legacy migration sources.
4. Legacy clients still contain `MEDLINK_API_URL` and localhost defaults.
5. CSRF mutation tests, rate limiting, realtime, and live database evidence are
   outstanding.

The gateway MUST remain `PARTIAL` until those items are closed with executed
evidence. A successful Next.js build does not establish production readiness.
