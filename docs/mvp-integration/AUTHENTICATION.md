# Authentication and Authorization

Supabase owns user sessions and JWT issuance. `@medlink/platform` validates request context, resolves the tenant, and enforces the role-permission matrix for patient, pharmacist, pharmacy staff/owner, tenant administrator, and platform administrator. Agent calls use a system subject but remain tenant-scoped and auditable. API handlers must reject missing tenant, correlation, idempotency, or v1 version context before invoking domain services.

Certified end-to-end (browser, real magic-link login, real Postgres GRANT/RLS) in PR #29, `feat/multi-persona-auth-e2e-foundation`, for `apps/patient`, `apps/pharmacist`, and `apps/pharmacy`. This section is the canonical description of that chain — extend it here rather than opening a new document.

## The authority chain

Every authenticated request resolves through the same sequence, regardless of which app or persona initiates it:

```
Supabase auth.users                  (identity authority)
        |
cookie-based authenticated session   (@supabase/ssr, per app)
        |
user_profiles                        (profile authority — display data only)
        |
organization_memberships             (membership authority — who belongs where)
        |
member_role                          (role authority — enum on the membership row)
        |
server-validated active tenant/context (packages/api authenticate(); see below)
        |
permissions                          (packages/platform's role→permission set)
        |
runApi / runExperienceApi            (the one canonical entry point every route uses)
        |
Postgres GRANT                       (table-level privilege — necessary, not sufficient)
        |
RLS                                  (row-level policy — necessary, not sufficient)
        |
domain operation
```

No authority is skipped and none is duplicated per app: `auth.users`, `user_profiles`, `organization_memberships`, and `member_role` are each single, shared tables — patient, pharmacist, and pharmacy staff read the same schema through the same `runApi`/`runExperienceApi` pipeline. There is no per-app identity table, no per-app role enum, and no per-app permission matrix.

### Session model

`apps/patient`, `apps/pharmacist`, and `apps/pharmacy` each carry their own `lib/supabase/server.ts`, `middleware.ts` (session refresh only), `app/auth/sign-in/{page.tsx,actions.ts}` (magic link via `signInWithOtp`), and `app/auth/callback/route.ts` (`exchangeCodeForSession`) — a direct extension of the pattern `apps/web` already established, not a new session mechanism. Each app is self-contained: no cross-app cookie-domain sharing exists or is implied by this design. Logout is a real UI control (`signOut()` server action) in every app's layout, not a client-side redirect.

### Context selection: `x-medlink-tenant-id`

A user may hold more than one active `organization_memberships` row (see Multi-persona model below). `packages/api`'s `authenticate()` resolves the active tenant as follows:

- An explicit `x-medlink-tenant-id` header, if present, is treated as a **requested** context — never as authority by itself. The server still validates it against a real, active membership row for the authenticated user before honoring it.
- With no explicit header and exactly one active membership, that membership's organization is selected deterministically (the only possible context).
- With no explicit header and zero or multiple active memberships, the request fails closed with `403 tenant_context_required` — the server never guesses.

The client may *suggest* a context (via the header); it can never *grant* one. Authorization always derives from a verified `organization_memberships` row, never from a header, query param, or client-held state.

## Multi-persona model

```
ONE IDENTITY (auth.users row)
        |
MULTIPLE MEMBERSHIPS (organization_memberships rows, one per org)
        |
MULTIPLE VALID PERSONA/TENANT CONTEXTS
```

A single MedLink identity may legitimately hold multiple memberships — but never two roles inside the *same* organization (`organization_memberships` has `unique(organization_id, user_id)`). Certified personas: **PATIENT**, **PHARMACIST**, **PHARMACY_STAFF**.

- **Ambiguous context** (multiple memberships, no explicit selection): fails closed.
- **Explicit context**: server-validated against real membership rows before being honored.
- **Switching context**: never creates a second identity, never changes membership, never elevates privileges beyond what the selected membership's role actually grants.

## Defects discovered and fixed while certifying this (architectural lessons)

**A. Cookie authorization must never be synthesized empty.** `requestDatabase()` previously set `Authorization: request.headers.get("authorization") ?? ""`. No browser request ever carries an explicit `Authorization` header (only a session cookie) — the forced empty string suppressed `@supabase/ssr`'s own per-request attachment of the cookie-derived session token, so every authenticated data query silently ran as Postgres role `anon`, even though `auth.getUser()` (a separate code path) correctly identified the signed-in user. **Invariant**: an authenticated server-side database request must propagate the real session/JWT; never synthesize an empty `Authorization` override in its place.

**B. A GRANT and a policy are both required — neither is sufficient alone.** `organizations`, `user_profiles`, `organization_memberships`, `medicines`, `pharmacy_locations`, and `clinical_validations` each already carried real, correctly-scoped `to authenticated` RLS policies, but had never received a table-level `GRANT` — invisible until (A) was fixed and a real authenticated session finally reached PostgREST instead of falling back to `anon`. **Invariant**: effective authorization requires table `GRANT` **and** RLS policy **and** a validated actor context — the absence of any one of the three fails the request; the presence of an RLS policy alone is not evidence of a working data path. Privilege certification now covers these runtime identity/clinical/pharmacy tables. This is not license for blanket grants: each grant added here is scoped to exactly the operations (`select`, or `insert` for service-role fixture provisioning) that a real, tested code path requires.

**C. Every supported callback origin must be explicitly allowlisted, and the magic-link parser must target the actual authentication link.** Supabase's default magic-link email links to GoTrue's own `/auth/v1/verify` endpoint (which then redirects to the app's `/auth/callback`), not directly to the app URL — a link-matching approach must account for that. Separately, `supabase/config.toml`'s `additional_redirect_urls` must explicitly list every app's callback origin (patient, pharmacist, pharmacy); an unlisted origin causes GoTrue to reject the redirect silently rather than send the user to the correct app.

## Future WhatsApp identity boundary

```
WhatsApp Phone Identity
        |
Identity Resolution
        |
EXISTING MedLink Identity (auth.users / user_profiles)
        |
organization_memberships
        |
persona/context
        |
permissions/RLS
```

A phone number may **identify or link** a MedLink identity. It must never **independently authorize** a MedLink domain operation. When WhatsApp becomes an interactive, persona-aware entry channel, phone-number resolution must terminate in this same `auth.users` → `organization_memberships` → `member_role` chain — WhatsApp must not introduce a second identity store, a second RBAC model, phone-number-only authorization, or independent tenant authority. Not implemented in this PR.

## Browser certification evidence (PR #29)

| Dimension | Result |
|---|---|
| Patient auth | PASS |
| Pharmacist auth | PASS |
| Pharmacy auth | PASS |
| Multi-persona | PASS |
| Tenant isolation | PASS |
| RLS | PASS |
| Session security | PASS |
| Browser auth suite | 9/9 PASS |
| Live medication regression | 23/23 PASS |

**Known, non-blocking test reliability debt**: 3 of the 9 browser auth tests required one CI retry due to Mailpit email-indexing timing (the poll can occasionally observe the recipient's inbox before the newest message is indexed). All 9 passed within the configured retry policy (`retries: 1` in CI); none failed outright. Post-RC1 backlog item: stabilize Mailpit polling/event synchronization so browser auth passes are retry-free. This is a test-harness timing issue, not an authentication defect — the fix belongs in the E2E harness's poll strategy, not in authentication design.
