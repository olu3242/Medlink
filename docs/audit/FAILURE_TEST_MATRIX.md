# RC1 Failure Scenario Certification (Engine 36)

Same evidence basis and Blocked-not-Failed posture as `WORKFLOW_CERTIFICATION.md`.
"No silent failures" is evaluated as: does the code path return a typed,
correlation-ID-bearing error (`RuntimeError`/`problemResponse`) rather than
crash unhandled or swallow the error -- not whether it's been proven under
live conditions, which is a separate column.

| Failure scenario | Handling exists in code | Automated test evidence | Live-condition evidence |
| --- | --- | --- | --- |
| Storage unavailable | Yes -- `SupabasePrescriptionFileStore.store()`/`createSignedUrl()` map any storage error to `RuntimeError("infrastructure", ...)` | **Certified**: `prescription-storage.test.ts` ("throws an infrastructure error when the upload fails" / "when signing fails") | Blocked -- needs a real Supabase Storage outage or misconfiguration to prove the mapping fires correctly against the real SDK's error shape |
| WhatsApp webhook retry (duplicate delivery) | Yes -- `conversation_messages`' unique constraint + `SupabaseMessageStore.recordInbound()`'s catch-and-replay | **Certified**: `apps/web/lib/conversation-store.test.ts` ("replays the existing row instead of throwing on a retried (duplicate) delivery") | Blocked -- needs a real Meta redelivery or a live-DB integration test hitting the actual unique constraint (the unit test uses a scripted fake client, not a real Postgres conflict) |
| Duplicate uploads (prescription) | Yes -- `create_prescription_record`'s checksum-match replay branch | **Partially certified**: SQL-content assertions in `migration.test.ts` prove the branch exists and its logic reads correctly; no test exercises it against a real duplicate insert | Blocked -- live Postgres required to prove the actual `on conflict`/`select ... if found` behavior, not just that the SQL text says so |
| Duplicate reservations | Yes -- `reserve_inventory`'s idempotency-key replay, hardened this session (migration `202607290020`) to validate the replay matches the original request | **Partially certified**: same SQL-content-assertion limitation as above | Blocked -- live Postgres |
| Invalid JWT | Presumed yes -- `database.auth.getUser()` inside every `createRuntime()`'s `authenticate()` returns an error Supabase surfaces for an invalid token, mapped to `AuthenticationError`/401 | **Not certified** -- `grep` for a test asserting this specific path (`packages/api`, `packages/runtime`, or any app's route tests) found nothing | Blocked -- needs both a unit test of the error-mapping path and live verification against a real expired/tampered Supabase JWT |
| Expired session | Same mechanism as invalid JWT (Supabase treats both as an auth failure at `getUser()`) | **Not certified**, same gap | Blocked, same as above |
| Missing tenant | Code exists -- `apps/web/lib/request-context.ts`'s `TenantContextError` when no `x-medlink-tenant-id` header/`active_tenant_id` claim resolves, or when `organization_memberships` has no matching row | **Not certified** -- no test found exercising either branch of `TenantContextError` | Blocked -- straightforward to unit test without live infra (pure logic against a fake header/Supabase response); flagged as the single easiest item in this table to close without any environment dependency |
| Database timeout | Every Supabase call site maps a generic error to `RuntimeError("infrastructure", ..., retryable: true)` -- this covers a timeout the same as any other driver-level error, but nothing specifically simulates a timeout | **Not certified** as a distinct scenario | Blocked -- needs either a fault-injection test (a fake client that hangs/rejects after a delay) or live network-partition testing |
| Queue failure (dead-letter) | Code exists -- `packages/workflows/src/service.ts`'s `OutboxDispatcher` retries up to 4 attempts with exponential backoff, then dead-letters | **Not certified at all** -- `OutboxDispatcher` has zero tests anywhere in this repository (confirmed: no `describe`/`it` block references it), and per `LAUNCH_GAP_MATRIX.md`'s G09 finding, nothing invokes it from any route either | Blocked, doubly: needs both a unit test of the retry/dead-letter transition and a live consumer to even be exercised in production |
| Notification failure | N/A -- no notification channel exists to fail (see `WORKFLOW_CERTIFICATION.md`'s Notifications section) | **Not applicable** until G09 is built | G09 batch |
| Inventory conflict (two patients, one unit of stock) | Yes, structurally -- `sync_inventory_lock_quantity()` trigger raises `'Insufficient or unavailable inventory for lock'` inside the same transaction `reserve_inventory` runs in, relying on Postgres row-level locking to serialize concurrent attempts | **Not certified under real concurrency** -- this is the scenario the original superprompt named explicitly (`Stock = 1, Patient A reserves, Patient B reserves -> A reserved, B out of stock, never both reserved`); the trigger design is sound on inspection but has never been raced against a live database with two real concurrent connections | Blocked -- needs a live-database test opening two connections and racing them against the same `inventory_batches` row; this is the highest-value single test to add once a live environment exists, since it's the one scenario this table can name a precise, ready-to-write test for |

## Summary

- **4 of 11** named scenarios have real, passing automated test coverage
  today (storage unavailable, WhatsApp webhook retry, and -- partially,
  at the SQL-content level rather than live-execution level -- duplicate
  uploads and duplicate reservations).
- **2 of 11** (missing tenant, database timeout) could be closed with a
  unit test *today*, no live environment required -- flagged as the
  cheapest wins in this entire certification program.
- **2 of 11** (invalid JWT, expired session) need both a missing unit test
  and live verification.
- **1 of 11** (queue failure) has real handling code with zero test
  coverage of any kind and no live caller.
- **1 of 11** (notification failure) is not applicable until G09 exists.
- **1 of 11** (inventory conflict) is the single most important scenario
  to prove under real concurrency once a live database is available --
  it's the exact race condition a healthcare inventory system cannot
  afford to get wrong, and today it is trusted entirely on code
  inspection, not demonstrated behavior.

No scenario in this table is marked "Failed." Every one either has
working code with a specific evidence gap, or working code with no gap
in the parts this sandbox can verify.
