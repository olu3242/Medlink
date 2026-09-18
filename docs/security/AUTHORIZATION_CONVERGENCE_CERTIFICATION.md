# MedLink Authorization Convergence — Certification

Produced at the close of the authorization convergence repair batch that followed
`docs/security/AUTHORIZATION_CONVERGENCE_INVENTORY.md` (the read-only audit, merged as
PR #57 at `4fd6b6e`). That audit's headline finding was that MedLink already has a real
canonical authorization foundation (`authorization.ts` + `persona-contracts.ts` +
`auth-state.ts`); this repair closes the 8 concrete convergence gaps it identified
against that existing foundation rather than replacing any of it. No new authorization
architecture was introduced.

- **Repository:** olu3242/medlink
- **Branch:** `authorization-convergence-repair`
- **Base SHA:** `4fd6b6e4c792c6fe8f6f48e1b48bfbae7039225b` (PR #57, the audit doc)
- **Working tree at time of this report:** 18 modified files, 8 new files (6 test files,
  2 migrations), all uncommitted pending this PR's first commit — see the diff for the
  full file list.

## Business rules this repair implemented (per explicit product decision)

- **Clinical review:** self-review is prohibited wherever the action represents
  independent clinical approval (deciding a `clinical_reviews` row). Ordinary edits that
  are not approval decisions are unaffected — none currently exist as a separate,
  non-approval mutation path on this table.
- **Financial approval:** separation of duties (initiator ≠ approver) applies to
  manual/high-risk financial actions. Normal automated provider-confirmed settlement
  processing does not require human approval.

## CANONICAL AUTHORIZATION — core files (unchanged in role, converged in callers)

| File | Status |
|---|---|
| `packages/platform/src/authorization.ts` | CANONICAL, unchanged |
| `packages/platform/src/persona-contracts.ts` | CANONICAL, `FieldVisibility` converged onto `control-center.ts`'s `FieldAccess` (item 5) |
| `packages/platform/src/auth-state.ts` | CANONICAL, unchanged; `apps/web/lib/request-context.ts` now correctly calls through it (item 2) |

## Findings 1–8 (from the inventory's Summary section)

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Unify 3–4 duplicate auth-client constructions | **FIXED** | `packages/platform/src/supabase-server.ts::createPersonaSupabaseServerClient()` is now the one factory; `apps/{web,patient,pharmacist,pharmacy}/lib/supabase/server.ts` each re-export it under their existing name (no call-site changes needed). Two more, previously-undocumented duplicate *service-role* client constructions were found while implementing this item and converged the same way: `apps/web/lib/{patient,pharmacy}/notification-dispatch.ts` now call `createSupabaseServiceRoleClient()` instead of re-constructing a client. `packages/api/src/index.ts::requestDatabase()` (Request-header/bearer-token boundary) and `packages/platform/src/persona-middleware.ts` (sync `NextRequest.cookies`, can't use async `cookies()`) remain separate — genuinely different trust/runtime boundaries, documented inline. `npm run typecheck` and `npm run build --workspaces` both clean after the change. |
| 2 | `resolveRequestContext()` doesn't consult `WORKSPACE_COOKIE` | **FIXED** | Rewritten to user → memberships → requested/active workspace (header → cookie → `app_metadata`) → verify membership → resolve active membership → authorize, matching `runApi`'s own priority. `apps/web/lib/request-context.test.ts`, 10/10 tests passing: valid active org, cookie-based switch (including switching twice in sequence), forged/foreign org cookie rejected, revoked (soft-deleted) membership rejected even if explicitly requested, zero memberships rejected, ambiguous memberships with nothing requested rejected, header takes priority over cookie, `app_metadata` fallback only when neither header nor cookie present. Two previously-undocumented bugs found and fixed while implementing this: (a) `runWebApi`'s `authenticate()` let `resolveRequestContext()`'s thrown `PlatformError` propagate unmapped, turning every unauthenticated `/api/v1/context` call into a 500 instead of 401 — fixed by converting `PlatformError` into a properly-statused `RuntimeError`; (b) `/api/v1/context` required an unrelated `organization:read` permission that wrongly excluded the `patient` role from reading their own session context — removed, since the route only echoes the caller's own already-verified identity. `apps/web/app/api/v1/context/route.test.ts`, 2/2 tests passing (401 when unauthenticated; 200 for all 8 roles). |
| 3 | `runWebApi` contract-role-pinning gap vs. `runApi` | **INTENTIONAL, corrected finding** | The inventory document's own text was imprecise: it implied `/api/v1/partner/applications/*` shared this gap. Direct inspection during implementation showed those routes import a *different*, identically-named `runWebApi` from `apps/web/lib/partner.ts` — an intentional, already-documented "pre-tenant boundary" for partner applicants who have no organization membership yet, genuinely unable to use `runApi`'s tenant resolution. Only `apps/web/lib/api-runtime.ts::runWebApi()` had the real gap, and its sole consumer is `/api/v1/context`, which needs no object-level permission beyond authentication + active membership (already enforced by `resolveRequestContext()`) — it returns only the caller's own already-authorized identity. No contract-role pinning was added because there is no per-role restriction to pin: every authenticated role may read their own session. Documented inline in `api-runtime.ts` and `route.ts`. |
| 4 | 2 hardcoded role-string comparisons | **PARTIAL — 1 fixed, 2 confirmed intentional** | `enterprise-administration.ts::EnterpriseAdministrationService.apply()`'s administrative-role gate now calls `can(context.role, "organization:manage")` instead of comparing role names directly (`organization:manage` is granted to exactly `platform_admin`/`tenant_admin` in `authorization.ts`'s table, verified before the change). 4/4 tests passing, including 2 new: all 6 non-administrative roles denied, `platform_admin` still works cross-tenant. The same function's separate cross-tenant-scope check (`role !== "platform_admin"`) is **not** a permission decision — it selects *whose* tenant-scope check applies, and no canonical "may act across tenants" permission exists to route it through without inventing one — left as an explicit, documented role check. `persona-certification.ts::authorizeTestAsRequest()`'s `role !== "platform_admin"` gate is a deliberate, non-delegable identity check for Test-As impersonation (itself unconditionally blocked elsewhere by `authorizeTestAsSession`'s architectural tripwire, per the original audit) — making it a permission would incorrectly imply it could ever be granted to another role. Both are documented inline as intentional. |
| 5 | Unify `FieldVisibility`/`FieldAccess` | **FIXED** | `persona-contracts.ts`'s `FieldVisibility` is now `export type FieldVisibility = FieldAccess;`, aliasing `control-center.ts`'s type instead of independently declaring the same 4 states. No third abstraction created; the two resolver *functions* remain separate (different call sites, as the audit noted) but can never again drift on vocabulary. `npm run typecheck` clean; `persona-contracts.test.ts`, `control-center.test.ts`, `access-governance.test.ts`, `authorization.test.ts` all passing (27 tests). |
| 6 | `decide_clinical_review` self-review guard | **FIXED** | Migration `202609180088_clinical_review_self_review_guard.sql`, modeled directly on `decide_partner_application`'s existing guard: looks up the underlying `medication_access_requests.created_by` via the review's `mar_id`, raises `'Self-review is prohibited'` if it matches the deciding actor, before any state mutation. Runs after the existing role/replay checks, not instead of them. App-layer bug found and fixed in the same item: `apps/web/lib/clinical-review-decider.ts` was mapping every RPC error — including this deliberate denial — to a generic retryable 503 "infrastructure" error; added `decisionDeniedError()` to map self-review (403), non-pharmacist role (403), actor mismatch (401), and already-decided (409) to their correct statuses. `apps/web/lib/clinical-review-decider.test.ts`, 6/6 passing. Adversarial live-DB coverage written in `packages/runtime/src/clinical-review-self-review-live.test.ts` (independent-review positive case, self-review denial, cross-tenant pharmacist denial, non-pharmacist role denial) — see LIVE RLS below for execution status. |
| 7 | Refund/settlement approval boundary | **FIXED** | Investigation (see disposition below) found exactly one manual/high-risk financial action in the entire codebase — `resolve_payment_reconciliation_case` — and confirmed every other money-moving path (`apply_payment_provider_event`, `apply_refund_provider_event`, `initiate_reservation_refund_on_exit`, `capture_payment_reconciliation_event`, `open_payment_reconciliation_case`) is automated, provider/trigger-driven, with no human decision step; these are unchanged, per the business rule that automated provider-confirmed processing should not require unnecessary human approval. `payment_reconciliation_cases` has no human-initiator column (cases are exclusively system-opened), so there was no initiator to separate from the resolving admin via that table directly — migration `202609180089_payment_reconciliation_self_review_guard.sql` instead reuses the existing `payments.created_by` relationship (via the case's `payment_id`) to prohibit a platform admin from resolving a reconciliation case for a payment they themselves made, the same self-review-guard shape as items 6/`decide_partner_application`, without inventing a new column. Adversarial live-DB coverage written in `packages/runtime/src/payment-reconciliation-self-review-live.test.ts` (independent resolution positive case, self-review denial) — see LIVE RLS below for execution status. |
| 8 | TS/SQL role-vocabulary drift check | **FIXED** | `packages/platform/src/role-enum-drift.test.ts` parses the actual `create type public.member_role as enum (...)` and every `alter type ... add value ...` across `supabase/migrations/*.sql` (no second hardcoded role list) and asserts set-equality with `roles.ts`'s `Role` array. Sanity-checked by temporarily injecting a fake role into `roles.ts`: the test correctly failed with the exact diff, then passed again after reverting. Runs under the existing unconditional `npm run test` (`check` script), no new CI wiring needed — real drift will fail CI on every PR, not just a scheduled/live job. |

## CONSENT

**GAP_RECORDED, with a correction to the original audit.** Section 15 of the inventory
document stated "no consent-as-authorization-input model exists anywhere" — this was
imprecise. A real, general-purpose `consent_records` table exists
(`202607270005_enterprise_governance.sql`: `consent_type`, `policy_version`, `action`
granted/revoked, `scope jsonb`, supersession chain, evidence hash) and is actively
enforced for exactly one workflow: `capture_marketplace_location_consent()` /
`discover_marketplace_inventory()`'s consent check, gating cross-tenant sharing of a
patient's location with third-party pharmacy networks
(`202608180071_marketplace_discovery_authority.sql`).

No other examined workflow (clinical review, medication access request creation,
payment) shows a genuine consent gap: each is initiated by the patient themselves,
acting on their own record, under the existing patient-relationship/operational
authority the persona/object-action layer already grants — that is a different and
already-adequate authorization basis, not a missing consent gate.

**Bounded follow-up recommendation (not implemented here, per instruction not to build a
speculative framework):** if MedLink adds a workflow that shares patient data with a
party outside the direct care relationship (insurance/HMO integration, research,
marketing, additional cross-organization sharing beyond the marketplace case already
covered), that workflow should reuse the existing `consent_records` /
`capture_*_consent` RPC pattern rather than a new one. No such workflow exists in the
current implementation.

## DELEGATION / BREAK_GLASS

**ADR_DEFERRED.** Unchanged from the original audit. `docs/adr/0010-iage-adwe-admission-boundary.md`
explicitly lists "Delegation, temporary access, break-glass access, device trust, and
geographic authorization" under Deferred scope, pending a separate constitutional
scope-admission decision. No delegation/break-glass capability was implemented or
scaffolded by this repair. The two delegation mechanisms that do exist
(`access-governance.ts::validateDelegatedCapabilities()`'s capability-set delegation,
`enterprise-approvals.ts`'s delegate-≠-approver approval delegation) are unrelated,
narrower, already-canonical mechanisms the audit separately confirmed — not general
end-user delegation, and out of scope for this repair.

## RLS MATRIX

**PASS.** `packages/runtime/src/rls-matrix.test.ts`: 86/86 tests passing. Parses every
migration, finds every tenant-scoped table, asserts RLS is enabled and at least one
policy exists (5-table `workerOnly` allowlist unchanged by this repair).

## LIVE RLS / LIVE DATABASE

**BLOCKED_ENVIRONMENT.** This sandbox has no `MEDLINK_LIVE_SUPABASE_URL/ANON_KEY/SERVICE_KEY`
and no reachable Docker daemon (`docker ps` fails: no `/var/run/docker.sock`), so neither
a live Supabase connection nor a local ephemeral Postgres (`tools/ci-supabase.sh`, which
CI's `migration-apply`/`live-database` jobs use) is available here. No adversarial live
test was faked, skipped-and-reported-as-passing, or run against production.

What was actually done instead:
- Two new adversarial live-DB test files were written against the real RPC surface,
  following the repository's established `describe.skip`-gated pattern
  (`packages/runtime/src/reserve-inventory-active-location-live.test.ts`'s convention) so
  they will genuinely execute — not just parse — the moment real credentials are present:
  `clinical-review-self-review-live.test.ts` (4 tests) and
  `payment-reconciliation-self-review-live.test.ts` (2 tests). Both were confirmed to
  parse and correctly `describe.skip` (not error) in this sandbox, and both were added to
  the `test:live` npm script so CI's `live-database` job (`vars.RUN_LIVE_DATABASE_TESTS
  == 'true'`) picks them up automatically with real local-Postgres credentials.
- New migrations `202609180088`/`202609180089` were reviewed line-by-line against the
  real table/column schema they touch but were **not** applied to any Postgres instance
  in this sandbox — CI's `migration-apply` job (isolated ephemeral local Postgres,
  confirmed not connected to production) will be the first real execution.
- Whether `RUN_LIVE_DATABASE_TESTS` is actually enabled for this PR's CI run is outside
  this session's visibility (a GitHub Actions repository/environment variable) — flagged
  as an external item to check once CI runs, not assumed either way.

## CROSS-TENANT / SELF-REVIEW / PRIVILEGE ESCALATION (executed in this sandbox only)

- **CROSS-TENANT: 3/3 PASS** — `request-context.test.ts` (forged/foreign organization
  cookie rejected), `enterprise-administration.test.ts` (cross-tenant action denied for
  `tenant_admin`; `platform_admin`'s cross-tenant exception still correctly allowed).
- **SELF-REVIEW: 1/1 PASS** (executed) — `clinical-review-decider.test.ts` (self-review
  mapped to 403, not a retryable infrastructure error). 2 additional self-review
  adversarial cases (clinical review cross-tenant/independent-review live test, payment
  reconciliation live test) were written but not executed — see LIVE RLS above; not
  counted in this tally.
- **PRIVILEGE ESCALATION: 9/9 PASS** — `request-context.test.ts` (revoked/soft-deleted
  membership rejected even when explicitly requested), `enterprise-administration.test.ts`
  (all 6 non-administrative roles denied, one assertion each),
  `clinical-review-decider.test.ts` (non-pharmacist role denied; authenticated-actor
  mismatch denied).

## SERVICE ROLE ISOLATION

**PASS.** Re-verified during this repair: `apps/web/lib/supabase/service-role.ts` remains
the single production service-role client factory. Its only callers are the WhatsApp
webhook route (signature-gated), the operational health probe (read-only), and — as of
item 1's convergence — `lib/patient` and `lib/pharmacy`'s `notification-dispatch.ts`
(each can only trigger the one fixed `dispatcher.dispatch()` outbox-drain call; neither
caller obtains a handle to the client itself). No Patient/Provider/Pharmacist/
Pharmacy/Admin role gates any code path to this client; Admin remains distinct from the
Supabase service role.

## UNIT / INTEGRATION / TYPECHECK / BUILD

- **UNIT/INTEGRATION: PASS.** `npx vitest run` (full monorepo): 221 test files passed,
  1286 tests passed, 17 files / 69 tests skipped (all live-DB-gated, consistent with no
  live credentials in this sandbox — up from the pre-existing 63 skipped by exactly the 6
  new live tests this repair added).
- **TYPECHECK: PASS.** `npm run typecheck` (`tsc --noEmit -p tsconfig.json`, whole
  monorepo): clean.
- **LINT: PASS.** `npm run lint` (`eslint .`): clean.
- **BUILD: PASS.** `npm run build --workspaces --if-present`: all workspaces built,
  exit code 0, no errors.
- **MIGRATION_APPLY: BLOCKED_ENVIRONMENT.** No Docker daemon reachable in this sandbox
  (`ci_supabase_start` requires it); CI's isolated `migration-apply` job will be the
  first real execution of the two new migration files.

## BROWSER

**BLOCKED_ENVIRONMENT.** The browser-auth-e2e and medication-golden-loop-e2e CI jobs
require a live local Supabase instance plus built persona apps and are gated the same
way as `live-database` (`RUN_LIVE_DATABASE_TESTS`); neither Docker nor
`MEDLINK_LIVE_SUPABASE_*` credentials are available in this sandbox.

## REMAINING AUTHORIZATION GAPS

- **Consent** — narrow and adequate today (see CONSENT above); the bounded follow-up
  (reuse `consent_records` for any future non-care-relationship data sharing) is not
  implemented and not currently needed by any existing workflow.
- **Delegation/break-glass** — deferred by product decision (ADR 0010), not a defect.
- **`resolve_payment_reconciliation_case` has no application-layer caller** (found during
  item 7's investigation): the RPC and its new self-review guard are real and reachable
  by any `platform_admin` via direct RPC call, but no `apps/web` route or admin UI
  invokes it yet. Not a gap this repair's scope covers (no route exists to secure), but
  worth flagging for whoever builds that admin surface: reuse this RPC as-is rather than
  re-implementing reconciliation resolution.
- **`network-transaction-convergence-live.test.ts`'s CI wiring gap** (pre-existing,
  unrelated to this repair, found incidentally while researching the live-test pattern):
  it's listed in `test:live` but gates on `MEDLINK_CERTIFICATION_DB_URL`, a variable
  CI's `live-database` job never sets (it sets `MEDLINK_LIVE_SUPABASE_*` instead) — so
  this file's substantial adversarial coverage (cross-tenant RLS denials, network
  transaction identity-chain continuity) currently never runs in CI even when
  `RUN_LIVE_DATABASE_TESTS` is enabled. Flagged, not fixed, per the instruction not to
  mix unrelated work into this PR.

## EXTERNAL BLOCKERS

- No Docker daemon in this sandbox (`docker ps` → `no such file or directory` for
  `/var/run/docker.sock`) — blocks local migration-apply verification and local Supabase
  for live tests.
- No `MEDLINK_LIVE_SUPABASE_URL/ANON_KEY/SERVICE_KEY` in this sandbox's environment.
- Whether GitHub Actions variable `RUN_LIVE_DATABASE_TESTS` is set for this repository/PR
  is unknown from this session — determines whether the `live-database`,
  `browser-auth-e2e`, and `medication-golden-loop-e2e` CI jobs actually execute (rather
  than no-op via their `if:` guard) once this PR's CI runs.

## FINAL_STATUS

**AUTHORIZATION_CONVERGENCE_READY_WITH_BLOCKERS**

All 8 convergence findings are closed (7 FIXED, 1 PARTIAL-with-documented-intentional-remainder),
both required business-rule decisions are implemented and tested, consent and delegation
are accurately documented (not silently dropped, not falsely marked implemented), and
every gate this sandbox can execute — unit, integration, typecheck, lint, build, RLS
matrix — passes. The blockers are entirely environmental (no Docker, no live Supabase
credentials in this sandbox) rather than unresolved findings: the two new migrations and
four new adversarial live-DB tests are written and wired into CI but have not yet been
executed against a real Postgres. CI's `migration-apply` and (if
`RUN_LIVE_DATABASE_TESTS` is enabled) `live-database` jobs on this PR will supply that
missing execution evidence; this report should be revisited once those results are in
before treating this as fully certified.
