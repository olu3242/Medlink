# RC1 Architecture Conformance Audit

## Audit identity

- Batch: S01.5
- Basis: `IMPLEMENTATION.md`, `docs/release-scope.md`, ADRs 0001–0003, and
  `docs/ENTERPRISE_RUNTIME_CONTRACT.md`
- Evolution policy: `docs/PLATFORM_EVOLUTION_FRAMEWORK.md`
- Method: source, migration, configuration, route, test, and documentation review
- Application code changed: no
- Result: **CONDITIONAL PASS — 70% source-level convergence**

The repository contains credible domain and database foundations, but it does
not yet conform to Conversation-Driven Architecture or the universal runtime
lifecycle. This is expected before Wave 3, but several existing implementation
patterns must be corrected before they become precedent for Wave 2.

## Evidence baseline

- `npm.cmd run lint`: pass
- `npm.cmd run typecheck`: pass across all apps and packages
- `npm.cmd test`: 26 files and 40 tests pass; one live database suite is skipped
- Admin, patient, and web production builds: pass
- Five ordered SQL migrations exist
- Runtime migration, RLS, integration, contract, performance, and recovery tests
  were not available

## Repository structure and ownership

| Artifact group | Owner | Finding |
| --- | --- | --- |
| `packages/platform`, `database`, `observability`, `ui` | Platform Foundation | Clear package boundaries; UI is shared presentation only |
| `packages/medicine`, `prescription`, `clinical`, `search` | Clinical Intelligence | Appropriate domain packages with focused unit tests |
| `packages/access`, `inventory`, `pharmacy`, `reservations` | Medication Access | Appropriate boundaries; APIs do not consume these services |
| `packages/workflows` | Workflow Orchestrator | Generic scaffold only; no canonical workflow definitions |
| `packages/notifications`, `payments`, `adherence` | Experience services | Small domain service scaffolds |
| `packages/ai`, `analytics` | Intelligence | Safety and privacy primitives exist; catalog is incomplete |
| `packages/governance`, `security`, `integrations`, `reporting`, `certification` | Enterprise Platform | Mostly small service contracts and database structures |
| `apps/admin` | Administrator Portal | Contains catalog API routes and UI |
| `apps/pharmacist` | Pharmacist Portal | UI client only; calls endpoints absent from this app |
| `apps/pharmacy` | Pharmacy Portal | UI client only; calls endpoints absent from this app |
| `apps/provider` | Hospital/Provider Portal | UI client only; several called APIs are absent |
| `apps/patient`, `apps/dashboard` | Legacy patient web surfaces | Page-centric and outside the primary CDA patient path |
| `apps/developer` | Developer/Operations Portal | UI client; called enterprise APIs are absent |
| `apps/web` | Platform shell | Only app using canonical request context and structured logger |
| `supabase/migrations/001–005` | System of Record | Strong static schema; sequencing no longer matches revised waves |

No package imports another domain package directly. That reduces cross-engine
coupling, but current API routes also bypass the packages entirely.

## Domain boundaries

Positive findings:

- MAR transition rules and human-review restrictions live in `packages/access`.
- Equivalency rules remain pharmacist-gated in `packages/medicine`.
- OCR output is forced to review in `packages/prescription`.
- Inventory and reservation services expose ports instead of SQL.
- AI outputs are typed as advisory and unable to transition an MAR.

Deviations:

1. Direct Supabase access was removed from protected `/api/v1` route handlers.
2. Catalog, prescription, and medication-access persistence was extracted into
   application services.
3. The workflow package is an execution loop, not the durable orchestrator
   defined by ADR 0003.
4. Conversation is not implemented as a bounded context.
5. Some planned application clients call APIs that do not exist in the
   repository, so portal completeness cannot be inferred from UI presence.

## Conversation-Driven Architecture

| Principle | Status | Evidence |
| --- | --- | --- |
| Conversations are the primary patient interface | Missing | Patient journey is implemented as Next.js pages |
| Domain engines are channel-neutral | Pass | Domain packages have no channel imports |
| Channels use versioned APIs | Partial | Existing routes use `/api/v1`; no channel adapter exists |
| Conversations invoke workflows | Missing | No Conversation Engine |
| Workflows invoke domain engines | Missing | Generic workflow service has arbitrary callback steps |
| Business truth stays in System of Record | Partial | Database is authoritative, but route logic bypasses domain layer |
| Steps are auditable/idempotent/replay-safe | Partial | MAR/database safeguards exist; no conversation safeguards |

The legacy patient web applications may remain fallback surfaces, but their
page navigation and direct API assumptions must not define the Wave 3 workflow.

## API review

Fifteen implemented route files were found. Application endpoints consistently
use `/api/v1`, except authentication callback infrastructure.

Convergence result:

- All 14 protected `/api/v1` route files and 20 handlers use the canonical
  runtime pipeline.
- Membership-backed tenant resolution, RBAC, validation, correlation/request
  IDs, safe problems, application delegation, audit/event hooks, and telemetry
  hooks are standardized.
- Architecture tests prevent direct Supabase and authentication calls in route
  handlers.
- Health and authentication callback routes remain explicit public runtime
  profiles.

Remaining deviations:

- Audit and operation-event evidence is durably committed together through
  migration 006, but not yet in the same transaction as existing business
  mutations.
- Metrics are process-local and trace propagation is correlation-based rather
  than backed by a distributed tracing provider.
- Live migration, RLS, rollback, and tenant-isolation evidence is blocked by the
  absence of Docker or Podman on the build host.
- Several portal clients reference routes with no implementation, including
  review decisions, referrals, reservation decisions, dashboard data, and
  developer operations.

## Database review

Static strengths:

- 53 canonical and supporting tables across five ordered migrations.
- RLS is enabled on the inspected tables.
- Tenant foreign keys, compound constraints, useful indexes, append-only audit
  triggers, MAR transition enforcement, and secret-hash constraints exist.
- MAR, inventory, reservation, workflow, notification, payment, AI, governance,
  integration, and security records are represented.

Gaps:

- No Conversation, Conversation Session, Message, Channel Identity, Handoff, or
  general Domain Event Outbox tables exist.
- `notification_outbox` is notification-specific, not the CDA event backbone.
- Workflow tables live in the Wave 5 migration although the revised roadmap
  requires orchestration in Wave 3.
- No migration ledger or runtime evidence proves migrations apply cleanly.
- No automated RLS test suite proves cross-tenant denial.
- The canonical Patient object is split between auth users and `user_profiles`;
  its ownership and lifecycle need an explicit contract.

Existing migrations must remain immutable once deployed. Corrective structures
should be additive and assigned to the appropriate active wave.

## Security review

Strengths include Supabase Auth integration, membership tables, a platform RBAC
map, broad RLS policies, webhook replay primitives, append-only audit tables,
hashed API credentials, redacted structured logging, and AI authority limits.

Gaps include inconsistent request-context use, no route-level RBAC in most APIs,
no WhatsApp signature or account-linking controls, no conversation consent and
retention implementation, no automated secret scanning, and no penetration or
threat-model evidence.

## Observability review

Pino structured logging and correlation IDs exist in the platform shell. A
health route exists. However, most apps do not propagate or log correlation
IDs. No metrics API, tracing spans, trace-context propagation, SLOs, alert
rules, queue health, or dependency health checks were found.

## Testing review

The 33 tests cover selected invariants plus runtime lifecycle, architecture
boundaries, replay safety, tenant/organization consistency, and canonical
workflow identity. They do not provide coverage
threshold evidence. There are no API integration tests, contract tests,
canonical workflow tests, route authorization tests, RLS runtime tests,
migration tests, end-to-end tests, performance tests, chaos/recovery tests, or
WhatsApp provider tests.

## Documentation consistency

`IMPLEMENTATION.md`, `release-scope.md`, and ADR 0003 agree on CDA and the 15
workflows. Earlier wave certification documents describe the previous roadmap
and overstate completion under the revised scope. ADR 0002 is correctly marked
superseded. App READMEs and root README do not consistently describe CDA.

## Decision

S01.6 and S01.7 source-level controls pass. Wave 2 remains gated by the
remaining S01.8–S01.10 P0 evidence in `RC1_BACKLOG.md`, particularly
transactional audit/events, durable telemetry, runtime integration/RLS,
performance, and recovery certification.
