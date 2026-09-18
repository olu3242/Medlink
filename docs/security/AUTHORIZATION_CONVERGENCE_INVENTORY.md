# MedLink Authorization Convergence — Inventory

> **Repair status:** all 8 items in this document's Summary section have been closed by
> the authorization convergence repair batch. See
> `docs/security/AUTHORIZATION_CONVERGENCE_CERTIFICATION.md` for the finding-by-finding
> disposition (FIXED/VERIFIED_EXISTING/INTENTIONAL/DEFERRED/BLOCKED), evidence, and the
> two corrections this repair made to findings below (item 3's `runWebApi` scope, and a
> narrow existing consent mechanism the original Section 15 missed).

Read-only audit, produced before any convergence work began. Scope: every existing
authentication, membership, persona, role, permission, object, field, workflow-state,
delegation, approval, RLS, audit, and service-role implementation in the repository.

**Headline finding:** this is not a greenfield authorization gap. A real canonical layer
already exists — `packages/platform/src/authorization.ts` (RBAC) plus
`packages/platform/src/persona-contracts.ts` (persona/object/field/workflow ABAC) plus
`packages/platform/src/auth-state.ts` (membership resolution). The actual problem is a
small, specific set of call-sites that don't fully route through that layer, plus a few
genuine, previously-undocumented gaps. Building a new parallel "AccessControlRegistry"
would itself become a seventh competing system and would violate the project's own
"one canonical architecture" principle — the correct convergence direction is to make
every caller route through the existing canonical layer, not replace it.

## Classification legend

- **CANONICAL** — the authoritative implementation; other code should call this.
- **DUPLICATE** — re-implements logic the canonical layer already owns, with the same or
  subtly different behavior; a convergence target.
- **LEGACY** — superseded but still referenced; safe to consolidate once callers move.
- **GAP** — no implementation exists where the architecture implies one should.
- **INCOMPLETE** — scaffolded (types/functions exist) but deliberately non-functional or
  only partially wired.

No code has been deleted or modified as part of producing this document.

---

## 1. Authentication (user resolution from a request)

| Implementation | Classification | Notes |
|---|---|---|
| `packages/api/src/index.ts::requestDatabase()` + `runApi().authenticate()` | CANONICAL (for `/api/v1` professional & experience routes) | Builds `@supabase/ssr` client from cookie header + optional `Authorization` bearer passthrough; calls `auth.getUser()`. Used by nearly every `apps/web/app/*/api/v1/*/route.ts`. |
| `packages/platform/src/supabase-server.ts::createPersonaSupabaseServerClient()` | DUPLICATE | Independent client construction for Server Components/pages. |
| `apps/web/lib/supabase/server.ts::createSupabaseServerClient()` | DUPLICATE | apps/web's own client, used by `request-context.ts` and `persona-access.ts`. |
| `apps/{pharmacy,pharmacist,patient}/lib/supabase/server.ts` | DUPLICATE (×3) | Near-identical clones of the apps/web version, one per legacy standalone app. |
| `packages/platform/src/persona-middleware.ts::enforcePersonaRequest()` | DUPLICATE (structurally necessary) | Independent client construction because Next.js middleware can't use the async `cookies()` helper the others rely on — this one has a real technical reason to be separate, unlike the other three. |

**Convergence target:** one shared client-factory helper in `packages/platform` that the
three page/API-route call-sites (`packages/api`, `apps/web/lib/supabase/server.ts`, the
3 per-app clones) all call, instead of each re-implementing cookie/bearer-header wiring.
The middleware client stays separate (different runtime constraints), but should be
verified to build an equivalent session.

## 2. Membership / tenant resolution

| Implementation | Classification | Notes |
|---|---|---|
| `packages/platform/src/auth-state.ts::resolveActiveMembership()` + `WORKSPACE_COOKIE` | CANONICAL | Filters deleted/suspended/expired memberships, resolves the selected org, auto-picks only when exactly one active membership exists. Explicit comment: a cookie/URL is never authorizing on its own. |
| `packages/api/src/index.ts::runApi().authenticate()` | CANONICAL caller | Resolves tenant via header → `WORKSPACE_COOKIE` → `app_metadata.active_tenant_id` → single-membership fallback; fails closed (403) on zero/multiple. Full priority chain. |
| `apps/web/lib/persona-access.ts::resolveSession()` | CANONICAL caller | Same priority chain (cookie before metadata), used by `requirePersonaAccess`/`resolveActiveSession`. |
| `packages/platform/src/persona-middleware.ts::enforcePersonaRequest()` | CANONICAL caller | Same pattern, for middleware-time portal gating. |
| `apps/web/lib/request-context.ts::resolveRequestContext()` | **GAP** | Resolves tenant via header → `app_metadata.active_tenant_id` **only** — does **not** consult `WORKSPACE_COOKIE`. This is the auth path for `runWebApi` (`apps/web/lib/api-runtime.ts`), used by `/api/v1/context` and `/api/v1/partner/applications/*`. A user who switched active organization via the workspace-switch cookie but whose `app_metadata` hasn't caught up could be authorized against the **wrong organization** on these specific routes. |

**Convergence target:** `resolveRequestContext()` should consult `WORKSPACE_COOKIE`
with the same priority as the other three paths. This is a real, narrow, low-risk fix
(add one cookie read to match an existing, proven pattern) — not a redesign.

## 3. Persona resolution

| Implementation | Classification |
|---|---|
| `packages/platform/src/persona-contracts.ts` (`PersonaContract`, `personaContractForRole`, `canAccessPortal`, `navigationForRole`, `isRouteAllowed`) | CANONICAL |
| `apps/web/lib/persona-access.ts` (`requirePersonaAccess`, `resolveActiveSession`, `canAccessPersona`) | CANONICAL caller (redirect/null-based wrappers around the same session resolution) |
| `packages/platform/src/persona-middleware.ts::enforcePersonaRequest()` | CANONICAL caller (middleware-time portal gate) |

No duplication found here beyond the auth/membership layers already covered above — this
layer is in good shape.

## 4. Role checking

| Implementation | Classification | Notes |
|---|---|---|
| `packages/platform/src/roles.ts` (`roles`, `Role`, `permissions`, `Permission`) | CANONICAL | Sole TS-side source of truth: 8 roles, 26 permissions. |
| `supabase` `public.member_role` Postgres enum, used directly by RLS policies and SQL functions | **GAP** (drift risk) | A second, DB-level role vocabulary with the same values as `Role`, but no automated check that the two stay in sync — only the persona/RLS test suites would catch a drift, and only if a test happens to cover the specific role. |
| `supabase/migrations/202607290017_decide_clinical_review.sql` (`has_organization_role(org, ['pharmacist'])`) | DUPLICATE | Role name hardcoded in SQL rather than referencing a shared vocabulary. |
| `packages/platform/src/enterprise-administration.ts::EnterpriseAdministrationService.apply()` | DUPLICATE | Hardcodes `role !== "platform_admin" && role !== "tenant_admin"` instead of calling `can()`. |
| `packages/platform/src/persona-certification.ts::authorizeTestAsRequest()` | DUPLICATE | Hardcodes `role !== "platform_admin"`. |
| `tools/provision-test-personas.mjs` | LEGACY-ADJACENT (test fixture, not production) | Re-lists the 8 roles as its own literal array; acceptable as test-fixture duplication, not a convergence target. |

**Convergence target:** the 2 hardcoded application-code role checks
(`enterprise-administration.ts`, `persona-certification.ts`) should call `can()`/a
declared permission instead of comparing role strings directly, so a future role
addition/rename doesn't require finding every hardcoded comparison by hand.

## 5. Permission checking (three-layer overlap — the largest real duplication cluster)

| Layer | Classification | Notes |
|---|---|---|
| `packages/platform/src/authorization.ts` (`rolePermissions`, `can()`, `authorize()`) | CANONICAL | Static role→permission RBAC, no request context. |
| `packages/api/src/index.ts` (`authorizeRuntimeContext`, `authorizeExperienceRole`, `authorizeRegisteredOperationRole`) | CANONICAL caller, correctly layered | Wraps `authorize()` for the base check, then adds a **second**, independent contract-role pin (is this role on the explicit allow-list for *this registered operation*, from `professionalOperations`/`integrationContract`) for `/api/v1` professional and experience routes. This two-layer design is intentional and appropriate — permission grants can be broader than a specific endpoint's allowed roles. |
| `apps/web/lib/api-runtime.ts::runWebApi()` | **GAP** | Used by `apps/web`'s own internal API routes (not the `/api/v1` professional contracts). Authenticates via the `request-context.ts` gap above, and authorizes with **only** `authorize(role, permission)` — missing the contract-role pinning layer `runApi` has. Any route on `runWebApi` that later needs per-endpoint role pinning beyond a raw permission grant has no mechanism for it today. |

**Convergence target:** decide whether `runWebApi`'s routes (`/api/v1/context`,
`/api/v1/partner/applications/*`) genuinely need contract-role pinning (if their
permission grants are already role-specific enough, the gap may be low-risk) — this is a
judgment call for whoever owns that route set, not a mechanical fix, and should be
resolved explicitly rather than left as an unexamined asymmetry.

## 6. Portal access

`canAccessPortal(role, portal)` in `persona-contracts.ts` — **CANONICAL**, confirmed to
be exactly `personaContractForRole(role)?.portal === portal`: portal-entry-only, no
object-level authority implied. Matches the task's Section 10 requirement exactly, with
no changes needed.

## 7. Object-level authorization

`ObjectPermission`/`ObjectScope`/`canPerformObjectAction()` in `persona-contracts.ts` —
**CANONICAL**. Ties object+action to workflow state via `WorkflowPolicy` when one is
declared for that object+action. No duplicate implementation found.

## 8. Field filtering

| Implementation | Classification | Notes |
|---|---|---|
| `FieldPolicy`/`FieldVisibility`/`projectPersonaFields()` in `persona-contracts.ts` | CANONICAL | Fail-closed: undeclared fields default to `"hidden"`. |
| `FieldAccess`/`resolveFieldAccess()` in `packages/platform/src/control-center.ts` | DUPLICATE | Same 4-state enum (`hidden`/`masked`/`read_only`/`editable`), independently typed, feeding a separate "effective access" resolver (`access-governance.ts::resolveEffectiveAccess()`) for the control-center/enterprise-administration governance surface. |

**Convergence target:** unify `FieldVisibility` and `FieldAccess` into one shared type.
The two resolution *functions* likely stay separate (they serve genuinely different
call sites — per-record field projection vs. platform/org/role effective-access
merging) but should share the vocabulary so a field state doesn't need translating
between two type systems with identical meaning.

## 9. Workflow-state authorization

CANONICAL and substantially built out: `WorkflowPolicy` type (persona-contracts.ts),
the MAR/clinical-review SQL state machine (`create_mar` → `validate_mar` →
`decide_clinical_review`, migrations `202607290016`–`19`, with idempotent-replay
handling added in `202607290020`/`21`), the reservation state machine
(`reservation_status` enum + `reserve_inventory` RPC, guarded/overloaded across several
migrations culminating in `20260729001401_retire_legacy_reserve_inventory_overload.sql`),
and the TS-side `packages/workflows` step/port definitions
(`createClinicalValidationStep`, `createPharmacistReviewStep`, `createReservationStep`).

**INCOMPLETE:** `packages/workflows/src/definitions.ts` catalogs ~15 canonical
workflow IDs structurally, but per `apps/web/lib/workflow-invoker.ts`, only
`medicine_search` has an executable step set wired end-to-end today — every other
workflow type throws `UnsupportedWorkflowTypeError` if invoked through the orchestrator.
This is pre-existing, documented scope (not something this audit is flagging as new),
but is relevant context for Section 14's "register stateful objects and allowed
transitions" — most of the catalog is structural only.

## 10. Delegation

| Implementation | Classification |
|---|---|
| `packages/platform/src/access-governance.ts::validateDelegatedCapabilities()` + DB trigger `enforce_permission_capability_delegation()` (migration `202608250085`) | CANONICAL (capability-set delegation) |
| `packages/certification/src/enterprise-approvals.ts` (`EnterpriseApproval.delegatedBy`, delegate-≠-approver check) | CANONICAL (approval delegation) |
| General end-user "delegate my access to another user" / break-glass access | **GAP, explicitly deferred** | `docs/adr/0010-iage-adwe-admission-boundary.md` names delegation and break-glass access as explicitly out of scope for the current architecture. This is a documented product decision, not an oversight. |

No `authorize()` / `authorizeDelegatedUser()` split exists (the Section 16 worry does
not apply here) — the two delegation mechanisms that do exist are narrow, tested, and
feed into the canonical decision path rather than bypassing it.

## 11. Approval / Separation of Duties

| Implementation | Classification | Notes |
|---|---|---|
| `decide_partner_application` (migration `202608180068`) | CANONICAL | Explicit self-review guard at 3 call sites: `applicant_user_id = auth.uid()` raises `Self-review is prohibited`. Live-tested (`packages/partner/src/live-database.test.ts`). |
| `decide_clinical_review` (migration `202607290017`) | **GAP (real, specific finding)** | No equivalent self-review guard found. The function checks `auth.uid() = target_actor_id` and organization-role membership, and has idempotent-replay handling, but does not appear to block a pharmacist from reviewing/approving their own submitted clinical item, unlike the partner-application flow which explicitly guards this. This should be verified against product intent (clinical review may have a different real-world actor separation than partner applications, e.g. the submitter and reviewer may already always be different people by construction) before being treated as a bug — but it is a genuine architectural asymmetry worth a deliberate decision either way. |
| Refund/settlement approval | **GAP** | No dual-approval gate found; refunds dispatch through a worker route gated by `authorizedWorkerRequest` (shared-secret bearer token), not a human approval step. May be intentional (automated refund policy) — flagged for product confirmation, not assumed to be wrong. |
| `packages/certification/src/enterprise-approvals.ts` | CANONICAL (release-process approvals) | 7-group release-gate certification; not a runtime SoD control. |

## 12. RLS

- 104 migration files; **37 contain `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY`**.
- `packages/runtime/src/rls-matrix.test.ts` — **CANONICAL** coverage gate: parses every
  migration, finds every tenant-scoped table (has `organization_id`), asserts RLS is
  enabled and at least one policy exists, unless the table is in an explicit
  `workerOnly` allowlist (5 tables: `notification_outbox`,
  `notification_delivery_attempts`, `integration_webhook_messages`,
  `integration_delivery_attempts`, `api_client_credentials`).
- `packages/runtime/src/live-rls-migration.test.ts` — narrow, certifies one specific
  read-only discovery-view migration never grants write access and never exposes raw
  MERDP ingestion records.
- `tools/provision-test-personas.mjs` — confirmed real (165 lines), provisions 8 real
  Supabase Auth test users across 3 profile tiers for RLS/persona live test runs.

RLS coverage itself is not re-audited table-by-table in this document (that is the
explicit scope of Part 12's own separate deliverable, the RLS coverage matrix) — this
section inventories the *testing infrastructure*, which is CANONICAL and already
enforces coverage on every future migration via `rls-matrix.test.ts`.

## 13. Audit

CANONICAL and centralized: `record_runtime_evidence` RPC is the single audit-write path,
called from `packages/api/src/index.ts::runApi()`'s `journal.commit()` hook on every
successful `/api/v1` operation, referenced by ~46 migration files. `RuntimeAudit`
interface (`packages/runtime/src/index.ts`) is the pluggable hook contract every
`createRuntime()` caller supplies. No competing audit-write path found.

## 14. Service-role usage

CANONICAL and single-sourced: `apps/web/lib/supabase/service-role.ts` is the only
production service-role client factory. Every reachable-by-request service-role code
path (4 internal worker routes, the payments webhook, the WhatsApp webhook) is gated by
either `authorizedWorkerRequest()` (shared-secret bearer token,
`apps/web/lib/worker-auth.ts`) or a webhook-signature check — **confirmed: none of them
sit behind only a human persona/role gate**. This directly satisfies non-negotiable #10
("human roles never receive service-role credentials") as currently implemented.

## 15. Consent / purpose

**GAP.** No consent-as-authorization-input model exists anywhere in `packages/platform`,
`packages/clinical`, or `packages/prescription`. The only "purpose" concept found is
`testAsPurposeSchema` in `packages/platform/src/persona-certification.ts` — the stated
purpose of a platform-admin impersonation ("Test-As") session, for audit trail, not a
general resource-access-purpose gate.

**INCOMPLETE:** `packages/platform/src/access-governance.ts::authorizeTestAsSession()`
blocks self-impersonation and expired/inactive sessions, but the function's name and
unconditional-throw structure (`TEST_AS_BACKEND_BLOCKED_BY_ARCHITECTURE`, `never` return
type) indicate Test-As impersonation is a deliberate architectural tripwire — scaffolded
but intentionally non-functional pending further design, not a working authorizer today.

---

## Summary: real convergence targets (not a new-registry build)

1. Unify the 3-4 duplicate page/API auth-client constructions behind one shared factory.
   **FIXED.** `packages/platform/src/supabase-server.ts::createPersonaSupabaseServerClient()`
   is now the single factory; `apps/web`, `apps/patient`, `apps/pharmacist`, `apps/pharmacy`'s
   `lib/supabase/server.ts` each re-export it. Two more, previously-undocumented duplicate
   *service-role* client constructions found and converged during implementation
   (`apps/web/lib/{patient,pharmacy}/notification-dispatch.ts` → `createSupabaseServiceRoleClient()`).
2. Fix `resolveRequestContext()` to consult `WORKSPACE_COOKIE` (matches 3 existing peers).
   **FIXED.** `apps/web/lib/request-context.ts` rewritten to the same
   user → memberships → requested/active workspace → verify → authorize sequence as its
   3 peers, header priority matching `runApi`. 10 new tests. Two previously-undocumented
   bugs found and fixed in the same file/its caller during implementation: `runWebApi`
   mapped unauthenticated calls to a 500 instead of 401, and `/api/v1/context` wrongly
   required an unrelated `organization:read` permission that excluded the patient role.
3. Decide and resolve the `runWebApi` contract-role-pinning gap relative to `runApi`.
   **CORRECTED FINDING.** This document's original text implied `/api/v1/partner/applications/*`
   shared `runWebApi`'s gap. It does not: that route imports a *different*,
   identically-named `runWebApi` from `apps/web/lib/partner.ts`, an intentionally separate
   pre-tenant boundary for applicants with no org membership yet. Only
   `apps/web/lib/api-runtime.ts::runWebApi()` (sole consumer: `/api/v1/context`) had the
   gap; resolved as INTENTIONAL — see certification doc item 3.
4. Replace the 2 hardcoded role-string comparisons with `can()`/declared permissions.
   **PARTIAL — see certification doc item 4.** `enterprise-administration.ts`'s
   administrative-role check now calls `can(role, "organization:manage")`. Its separate
   cross-tenant-scope check and `persona-certification.ts`'s Test-As identity gate remain
   intentional role comparisons (not security-permission decisions); reasoning documented
   inline at each site.
5. Unify `FieldVisibility`/`FieldAccess` into one type. **FIXED.**
   `persona-contracts.ts`'s `FieldVisibility` is now a type alias of `control-center.ts`'s
   `FieldAccess`, not a separately declared duplicate.
6. Decide, with product input, whether `decide_clinical_review` needs a self-review guard.
   **FIXED**, per the product decision recorded in the certification doc (self-review
   prohibited for independent clinical approval): migration `202609180088` adds the guard,
   modeled on `decide_partner_application`'s. Live and unit test coverage added.
7. Confirm refund/settlement dispatch is intentionally automated (no human approval gate).
   **FIXED**, per the product decision recorded in the certification doc (SoD for
   manual/high-risk actions, no gate on automated processing): automated payment/refund
   paths confirmed unchanged; the one manual financial action in the codebase,
   `resolve_payment_reconciliation_case`, gained a self-review guard (migration
   `202609180089`) reusing `payments.created_by` rather than inventing a schema column.
8. Decide whether a TS/SQL role-vocabulary drift check is worth adding to CI. **FIXED.**
   `packages/platform/src/role-enum-drift.test.ts` parses the actual `member_role`
   migration SQL (no second hardcoded role list) and fails on any difference from
   `roles.ts`; runs under the existing unconditional `npm run test`/`check` CI step.

None of these required a new abstraction — each was a small, targeted fix to an existing,
otherwise-sound canonical layer. Consent-as-authorization-input and general end-user
delegation remain genuine, larger topics: Section 15's "no consent model exists anywhere"
was itself imprecise (a real, narrow `consent_records` mechanism exists and gates
marketplace location discovery — see certification doc item 11); delegation remains
explicitly deferred by product decision (ADR 0010, certification doc item 12). Neither
was implemented as part of this repair, per instruction.
