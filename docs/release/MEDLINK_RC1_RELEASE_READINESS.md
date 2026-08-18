# MedLink RC1 MVP release readiness

Canonical certification baseline: `3f93092ba90369a6e4921fedcf7ef0236d503fcd`
(PR #37 merged). This document classifies the assembled product separately
from external-provider production certification. A simulator, fixture, local
Supabase stack, or deterministic adapter is never treated as live-provider
evidence.

## Release verdict

**RC1_FUNCTIONALLY_CERTIFIED — LIVE_PROVIDER_CERTIFICATION_REQUIRED**

The assembled three-persona medication-access product is E2E certified. A
production release is not yet `MVP_RELEASE_READY` because no evidence in this
repository proves execution against the intended hosted Supabase deployment,
payment provider, Meta WhatsApp account, Anthropic account, production OCR and
prescription-structure providers, or production notification delivery path.
Managed backup/restore, environment-parity, target-deployment smoke, and
rollback exercises also remain deployment gates.

## Status model

- `NOT_IMPLEMENTED`: no usable implementation exists.
- `FUNCTIONALLY_IMPLEMENTED`: implementation and focused tests exist.
- `E2E_CERTIFIED`: the assembled path has deterministic application/database
  evidence, including real PostgreSQL where transaction semantics matter.
- `LIVE_PROVIDER_CERTIFIED`: the actual production provider path was exercised
  with retained evidence.

## Product release matrix

| Capability | Status | Release critical | Evidence |
| --- | --- | --- | --- |
| Authentication | E2E_CERTIFIED | Yes | `packages/e2e/tests/auth.spec.ts`; real magic-link, cookie session, GRANT, and RLS in CI |
| Patient browser | E2E_CERTIFIED | Yes | `packages/e2e/tests/golden-loop.spec.ts` |
| Pharmacist browser | E2E_CERTIFIED | Yes | governed review and cross-persona denial in the golden loop |
| Pharmacy-staff browser | E2E_CERTIFIED | Yes | confirmation, READY, credential verification, and collection in the golden loop |
| Assistant API | E2E_CERTIFIED | Yes | authenticated Alice call, escalation persistence, and zero-reservation authority proof |
| Agent/AI runtime | E2E_CERTIFIED | Yes | governed executor identity/capability/persona/action evidence; PR #37 |
| Medication identity | E2E_CERTIFIED | Yes | canonical medicine continuity through review, discovery, inventory, and reservation |
| NAFDAC/MERDP registry | E2E_CERTIFIED | Yes | published/quarantine boundaries and source lineage tests; no reacquisition in this phase |
| Geo consent and distance | E2E_CERTIFIED | Yes | browser geolocation plus missing-consent and 1–200 km boundary tests |
| Discovery matrix | E2E_CERTIFIED | Yes | exact/generic/both/none deterministic classification tests |
| Pharmacist governance | E2E_CERTIFIED | Yes | generic protection and authority-bypass escalation |
| Inventory and price | E2E_CERTIFIED | Yes | authoritative batch/medicine/tenant binding and price assertions |
| Reservation | E2E_CERTIFIED | Yes | atomic lock, revalidation, duplicate submission, race, expiry, and tenant tests |
| Payment and refund | E2E_CERTIFIED | Yes | signed webhook, amount/reference binding, failure/retry, expiry, and refund E2E |
| Fulfillment | E2E_CERTIFIED | Yes | authorized confirmation/READY/COLLECTED and invalid-transition denial |
| Notifications | E2E_CERTIFIED | Yes | domain event → outbox → simulated WhatsApp delivery; credential exclusion |
| WhatsApp channel | E2E_CERTIFIED | Yes | signature, verification token, replay, persona resolution, and browser continuity |
| Audit/reconciliation | E2E_CERTIFIED | Yes | persisted agent, MAR, reservation, payment, fulfillment, and outbox chain |
| Tenant/persona isolation | E2E_CERTIFIED | Yes | browser, API, RLS, cross-tenant, and forged-context denial |
| Observability | FUNCTIONALLY_IMPLEMENTED | Yes | structured logs, correlation IDs, health, runtime evidence, diagnostics, and metrics |
| Recovery/runbooks | FUNCTIONALLY_IMPLEMENTED | Yes | deterministic schema recovery and runbooks; production data recovery remains unproved |

## Provider certification

Each dependency receives exactly one status. These classifications describe
provider evidence, not whether the product integration is release-critical.

| Provider/dependency | Status | Evidence and remaining live gate |
| --- | --- | --- |
| Supabase/PostgreSQL | E2E_CERTIFIED | Real local PostgreSQL/Supabase, migrations, auth, RLS, locking, and replay run in CI. Certify the intended hosted project, network, secrets, backups, and restore. |
| NAFDAC/MERDP data | E2E_CERTIFIED | Canonical imported dataset, provenance, publication, quarantine, manufacturer, and identity compatibility are certified. No live upstream acquisition was executed in this phase. |
| Geo | E2E_CERTIFIED | Internal coordinate/distance mode is assembled and certified. Google/Mapbox are optional and not live-certified. |
| Payment | E2E_CERTIFIED | Provider contract and complete signed-webhook lifecycle run against the deterministic simulator. Certify the selected production processor, credentials, webhook registration, currency, and settlement/reconciliation. |
| Meta WhatsApp | E2E_CERTIFIED | Graph API adapter, signature verification, verification-token flow, replay protection, and delivery lifecycle run against the simulator. Certify the production Meta app, number, webhook, templates, and delivery receipts. |
| Agent/AI | E2E_CERTIFIED | Anthropic-compatible adapter and governed Alice loop run through a deterministic endpoint. Certify the approved production model/account, safety configuration, quotas, and outage behavior. |
| Notification | E2E_CERTIFIED | Transactional outbox and WhatsApp delivery consequence are E2E certified. Live status depends on Meta certification and production scheduler execution. |
| OCR | E2E_CERTIFIED | Clinical pipeline calls an HTTP OCR provider through the deterministic E2E endpoint. Certify the selected production OCR provider and data-processing controls. |
| Prescription structure | E2E_CERTIFIED | Parser contract and clinical pipeline run through the deterministic E2E endpoint. Certify the selected production provider and data-processing controls. |

## Assembled business evidence

The CI `medication-golden-loop-e2e` job uses isolated authenticated patient,
pharmacist, and pharmacy contexts; real Postgres, migrations, RLS, RPCs, and
locks; and deterministic external adapters. It proves:

```text
signed WhatsApp intent
→ patient assistant escalation boundary
→ prescription and canonical medication identity
→ pharmacist review
→ geo-consented BOTH_AVAILABLE discovery
→ authoritative inventory and price
→ duplicate-safe reservation and inventory lock
→ pharmacy confirmation
→ verified payment failure, retry, and success
→ READY notification without pickup credential
→ patient-only credential issuance
→ pharmacy collection
→ tenant/persona denial and audit reconstruction
```

The same CI job runs the payment/refund E2E, including reservation expiry,
inventory-lock release, provider refund intent, signed callback, duplicate
delivery, and reconciliation.

Focused regression suites cover the remaining product-level matrix and
negative outcomes: `EXACT_AVAILABLE`, `GENERIC_AVAILABLE`, `BOTH_AVAILABLE`,
`NONE_AVAILABLE`, missing geo consent, invalid radius, unapproved generic,
stale inventory, constrained-stock races, payment after expiry, invalid amount,
invalid fulfillment transitions, cross-tenant access, unauthorized personas,
webhook forgery, and prompt-injection attempts.

## Release configuration

`.env.example` is the canonical placeholder inventory. It contains no usable
credential. Production values belong in approved secret management. In
addition to application/provider variables, operations must configure external
schedulers for:

- `/api/internal/clinical-pipeline`
- `/api/internal/inventory-expiry`
- `/api/internal/notification-dispatch`
- `/api/internal/payment-refund-dispatch`

Each worker fails closed when its provider configuration or minimum-length
bearer token is missing. E2E-only loopback endpoint overrides reject real
provider credentials.

## Operations classification

| Area | Status | Classification |
| --- | --- | --- |
| Structured logging, correlation, runtime evidence | Source-tested | POST_MVP_HARDENING for production alert/dashboard tuning |
| Idempotency, webhook replay, notification retry/dead-letter | E2E certified | No product blocker |
| Reservation expiry and payment recovery | E2E certified | No product blocker |
| Dependency outage queue preservation | Runbook/source-tested | Production exercise required |
| Deterministic schema rebuild | CI certified | No migration blocker |
| Hosted database backup/PITR/restore | Not live certified | RELEASE_BLOCKER for production promotion |
| Deployment rollback and target smoke | Not live certified | RELEASE_BLOCKER for production promotion |
| Environment/secret/provider parity | Not live certified | RELEASE_BLOCKER for production promotion |

## Validation

At canonical baseline `3f93092`:

- Agent/AI: 108/108 passed.
- Migration-focused regressions: 203/203 passed.
- Full Vitest: 975 passed, 42 skipped live/integration tests.
- Browser CI: auth and medication golden-loop jobs passed.
- Builds: 8/8 passed.
- Lint and typecheck: passed.
- Migrations: 81 unique versions, 0 duplicates.
- Required CI: 10/10 jobs passed.

On the RC1 readiness branch after adding the release-configuration guard:

- Agent/AI: 108/108 passed.
- Security/RLS: 81/81 passed.
- Migration-focused regressions: 203/203 passed.
- Full Vitest: 977 passed, 42 skipped live/integration tests.
- Python: 12/12 passed.
- Builds: 8/8 passed.
- Lint and typecheck: passed.

## Exact release limitations

Before production promotion, retain evidence for:

1. intended hosted Supabase project deployment, migrations, RLS, tenant tests,
   backup/PITR, isolated restore, and approved RTO/RPO;
2. selected payment processor intent/webhook/refund/reconciliation lifecycle;
3. production Meta WhatsApp app, phone number, webhook, templates, outbound
   delivery, receipt persistence, and operational ownership;
4. approved Anthropic model/account invocation, safety/usage policy, quota,
   telemetry, and provider-outage handling;
5. selected OCR and prescription-structure providers, including privacy and
   data-processing controls;
6. production notification and worker schedules, queue monitoring, retries,
   dead-letter recovery, and alerting;
7. environment-parity review, target-deployment smoke, rollback exercise, and
   release/operations approval.

Until those gates are executed, the correct verdict remains
`RC1_FUNCTIONALLY_CERTIFIED — LIVE_PROVIDER_CERTIFICATION_REQUIRED`, not
`MVP_RELEASE_READY`.
