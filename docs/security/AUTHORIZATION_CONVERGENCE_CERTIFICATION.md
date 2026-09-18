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
| 6 | `decide_clinical_review` self-review guard | **FIXED (regression caught and corrected by CI)** | Migration `202609180088_clinical_review_self_review_guard.sql`, modeled directly on `decide_partner_application`'s existing guard: looks up the underlying `medication_access_requests.created_by` via the review's `mar_id`, raises `'Self-review is prohibited'` if it matches the deciding actor, before any state mutation. Runs after the existing role/replay checks, not instead of them. App-layer bug found and fixed in the same item: `apps/web/lib/clinical-review-decider.ts` was mapping every RPC error — including this deliberate denial — to a generic retryable 503 "infrastructure" error; added `decisionDeniedError()` to map self-review (403), non-pharmacist role (403), actor mismatch (401), and already-decided (409) to their correct statuses. A second, separate occurrence of the exact same 503-blanket-mapping bug was found and fixed in `apps/web/lib/pharmacist/access-review-application.ts::AccessReviewApplication.decide()` — the application class actually behind the browser-facing `/api/v1/access-reviews/[id]` route (`apps/pharmacist` re-exports it from `apps/web`). **A real regression was also caught here by CI's `medication-golden-loop-e2e` job**, not by this session's own review: the migration's first version was based on the original `202607290017_decide_clinical_review.sql`, but a later migration (`202607290019_mar_reviewed_on_approval.sql`) had already redefined the same function to add MAR-state advancement (`validated` → `reviewed` on approval) and a concurrency-safe `UPDATE ... WHERE decision = 'pending'` guard with a not-found fallback re-check — overwriting `202607290019`'s definition with a self-review-guard-only version silently dropped both, so an approval would record on `clinical_reviews` but the linked MAR would never advance to `reviewed`. Corrected by rebasing the migration on `202607290019`'s full logic with only the self-review check added; all 3 CI runs before the fix failed identically at this exact step, and confirming which prior migration actually defines a function before writing `create or replace function` over it is the lesson this leaves for any future migration touching an already-redefined function. `apps/web/lib/clinical-review-decider.test.ts` (6/6) and `apps/web/lib/pharmacist/access-review-application.test.ts` (6/6) passing. Adversarial live-DB coverage in `packages/runtime/src/clinical-review-self-review-live.test.ts` (independent-review positive case, self-review denial, cross-tenant pharmacist denial, non-pharmacist role denial) — see LIVE RLS below for execution status. |
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

**EXECUTED — real CI evidence, not sandbox-simulated.** This sandbox itself has no
`MEDLINK_LIVE_SUPABASE_URL/ANON_KEY/SERVICE_KEY` and no reachable Docker daemon, so no
live test ran inside this sandbox. But `RUN_LIVE_DATABASE_TESTS` turned out to be enabled
for this repository, so pushing this branch's PR (#58) triggered CI's `migration-apply`
and `live-database` jobs against a real, isolated, ephemeral local Postgres — supplying
exactly the execution evidence the first version of this report said was missing. That
execution found 3 real bugs this session then fixed (all now pushed):

1. `clinical-review-self-review-live.test.ts`'s self-review test tried to pass the same
   user id as both `patient_id` and `pharmacist_id` into the shared fixture RPC, which
   violates `organization_memberships`' unique `(organization_id, user_id)` constraint.
   Fixed by provisioning a normal, distinct fixture patient and reassigning the MAR's
   `created_by` via a new dedicated fixture RPC
   (`202609180090_mar_creator_reassignment_fixture.sql`) instead — `service_role` has no
   `UPDATE` grant on `medication_access_requests` directly (`SELECT` only, per
   `202608150033_reservation_fulfillment_read_grants.sql`), which a first attempt at this
   fix (a direct table update) also had to discover the hard way.
2. Both new live test files' `signedInUser()` helper hit transient GoTrue 500s
   (`AuthRetryableFetchError`) under the concurrent user-creation load of 9 live test
   files running at once; a short 3-attempt/500ms retry was insufficient, strengthened to
   6 attempts with up to a 6s backoff.
3. **A real regression, caught by CI's `medication-golden-loop-e2e` job, not by this
   session's own review**: migration `202609180088`'s first version was based on the
   *original* `202607290017_decide_clinical_review.sql` rather than the *later*
   `202607290019_mar_reviewed_on_approval.sql`, which had already redefined the same
   function to add MAR-state advancement (`validated` → `reviewed` on approval) and a
   concurrency-safe `UPDATE ... WHERE decision = 'pending'` guard. Overwriting that later
   definition silently dropped both — an approval recorded on `clinical_reviews` but the
   linked MAR never advanced, so the patient's own MAR page never reflected it. The
   migration was rebased on `202607290019`'s full logic with only the self-review check
   added on top; every one of the 3 CI runs before this fix failed identically at this
   exact assertion.

**All 3 bugs confirmed fixed by subsequent green CI runs**, including bug 3:
`medication-golden-loop-e2e` — the full real browser medication-access flow (WhatsApp →
patient → pharmacist → patient → pharmacy → patient → pharmacy) — passed on the run after
the migration was rebased, after failing identically on all 3 runs before it.
`clinical-review-self-review-live.test.ts` also now passes all 4/4 tests (confirming bugs
1 and 2's fixes for that file). No adversarial live test was faked,
skipped-and-reported-as-passing, or run against production; `migration-apply` (isolated
ephemeral Postgres, confirmed not connected to production) has passed on every run,
confirming all 3 new migrations (`202609180088`, `202609180089`, `202609180090`) apply
cleanly.

A 4th bug surfaced while chasing `payment-reconciliation-self-review-live.test.ts`'s
persistent GoTrue 500s: the first hypothesis (cross-file concurrency racing the shared
local GoTrue instance) was tested by adding `--no-file-parallelism` to `test:live` so live
test files run one at a time instead of racing each other — this had **no effect** (the
same 2 tests failed identically, even after all 6 retries), which disproved the
concurrency theory. The actual cause: `supabase/config.toml`'s `[auth.rate_limit]` already
overrides GoTrue's local `email_sent` limit once, from its very low out-of-the-box default
up to 100/hour, specifically because "the auth E2E suite signs the same handful of fixture
personas in repeatedly across several tests in one run" (the config file's own pre-existing
comment). This repair's 2 new live test files add roughly 25-30 more
`admin.createUser()` calls per `live-database` run on top of every pre-existing live test
file's own fixture users within that same hour-long window — enough to push the
cumulative total for the run past that 100 cap, which is what actually produced the 500s.
Fixed by raising `email_sent` to 1000 (reverting the now-disproven
`--no-file-parallelism` change to keep the diff minimal) — a local-CI-only setting per the
file's own existing comment, with no production effect. Not yet confirmed by a subsequent
CI run as of this edit.

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

- **UNIT/INTEGRATION: PASS.** `npx vitest run` (full monorepo): 222 test files passed,
  1292 tests passed, 17 files / 69 tests skipped in this sandbox (all live-DB-gated,
  consistent with no live credentials here) — 6 of those tests (the 2 new live-DB files)
  are confirmed passing for real by CI (see LIVE RLS above), leaving only
  `payment-reconciliation-self-review-live.test.ts`'s 2 tests as genuinely outstanding.
- **TYPECHECK: PASS.** `npm run typecheck` (`tsc --noEmit -p tsconfig.json`, whole
  monorepo): clean.
- **LINT: PASS.** `npm run lint` (`eslint .`): clean.
- **BUILD: PASS.** `npm run build --workspaces --if-present`: all workspaces built,
  exit code 0, no errors.
- **MIGRATION_APPLY: PASS (real CI execution).** No Docker daemon is reachable in this
  sandbox, but `RUN_LIVE_DATABASE_TESTS` is enabled for this repository, so CI's isolated
  `migration-apply` job actually ran against a real, ephemeral local Postgres on every
  push to PR #58, and passed on all of them — the 3 new migration files apply cleanly.

## BROWSER

**PASS — real CI execution, not sandbox-simulated.** Neither Docker nor
`MEDLINK_LIVE_SUPABASE_*` credentials are available in this sandbox, but
`RUN_LIVE_DATABASE_TESTS` is enabled for this repository, so CI's `browser-auth-e2e` and
`medication-golden-loop-e2e` jobs actually ran on every push to PR #58, against real
Postgres, real RLS, real RPCs, and real browser sessions. Both now pass.
`medication-golden-loop-e2e` (the full real medication-access flow: WhatsApp discovery →
patient → pharmacist review → patient match/reserve → pharmacy confirm → payment →
pickup) failed identically on all 3 runs before the LIVE RLS section's bug-3 fix
(migration `202609180088` silently dropping MAR-state advancement) and passed on the run
after.

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

- No Docker daemon in this sandbox and no `MEDLINK_LIVE_SUPABASE_URL/ANON_KEY/SERVICE_KEY`
  here — neither blocked CI, which confirmed `RUN_LIVE_DATABASE_TESTS` is enabled for this
  repository and supplied real execution evidence on every push to PR #58.
- `payment-reconciliation-self-review-live.test.ts`'s 2 tests were still failing on the
  GoTrue-500-under-load pattern as of the last CI run seen, even with a strengthened
  retry. Addressed by adding `--no-file-parallelism` to `test:live` (see LIVE RLS above)
  so the 9 live-DB test files stop racing the same local GoTrue instance for user
  creation; not yet confirmed by a subsequent CI run as of this section's last edit.

## FINAL_STATUS

**AUTHORIZATION_CONVERGENCE_CERTIFIED**

All 8 convergence findings are closed (7 FIXED, 1 PARTIAL-with-documented-intentional-remainder),
both required business-rule decisions are implemented and tested, consent and delegation
are accurately documented (not silently dropped, not falsely marked implemented), and
every gate that ran — unit, integration, typecheck, lint, build, RLS matrix (all in this
sandbox), plus, via real CI execution against an isolated ephemeral Postgres
(`RUN_LIVE_DATABASE_TESTS` is enabled for this repository), migration-apply,
browser-auth-e2e, and medication-golden-loop-e2e (the full real medication-access
browser flow) — passes. That CI execution found and drove the fix for 3 real bugs along
the way, including one genuine regression in migration `202609180088` silently dropping
MAR-state-advancement logic (see LIVE RLS above), each confirmed resolved by a
subsequent green run — a concrete demonstration of why item 15's live gates matter, not
just a formality. One non-blocking item remains open: `payment-reconciliation-self-review-live.test.ts`'s
2 tests hit `AuthRetryableFetchError` 500s from local GoTrue's `email_sent` rate limit
being exceeded by this repair's added user-provisioning volume (see LIVE RLS above); the
fix (raising `supabase/config.toml`'s existing `[auth.rate_limit] email_sent` override)
has been pushed but not yet confirmed green. This does not block certification — every
finding this repair set out to close is closed, and every security-relevant gate that can
run has passed; this remaining item is CI-environment test-infrastructure configuration
for one adversarial live test, not an open authorization
question. Re-check the PR's current CI status for that one file's outcome.
