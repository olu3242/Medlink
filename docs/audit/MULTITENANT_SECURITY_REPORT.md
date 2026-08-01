# RC1 Multi-Tenant Isolation Report (Engine 38)

Same evidence discipline as the rest of this program: static/source
evidence is real and cited precisely; every adversarial scenario the
original request named is either backed by that static evidence or marked
Blocked with the exact missing dependency. No penetration test was
executed -- this repository has no live environment to run one against,
and an independent penetration report is separately listed as an open
GA-blocking item in `docs/release/rc1-ga/SECURITY_CERTIFICATION.md`, which
this document does not duplicate or substitute for.

## Static RLS coverage (source evidence)

`packages/runtime/src/rls-matrix.test.ts` auto-discovers every
`public.*` table across all migrations containing an `organization_id`
column (57 tables as of this integration merge) and asserts each either
(a) has RLS enabled and at least one policy, or (b) is in the explicit
`workerOnly` allowlist (service-role-only tables with intentionally zero
`authenticated` policies -- `notification_outbox`,
`conversation_messages`, `agent_memory_entries`, etc.). This is a real,
automatically-maintained guarantee: **a future migration cannot silently
drop RLS or a policy from a tenant table without this test failing** --
but it proves the *policy exists*, not that the *policy is correct* or
that it holds up against an adversarial authenticated session.
`packages/runtime/src/wave2-rls.test.ts`/`wave3-rls.test.ts` add
content-level assertions for specific policy bodies (matching the exact
role arrays and `organization_id` predicates), which is stronger than
existence-only but is still static text matching, not live behavior.

## Adversarial scenarios requested

| Scenario | Static evidence | Live verification |
| --- | --- | --- |
| Cross-tenant API requests (patient A reads patient B's org's data) | `prescriptions_read`, `reservations_*`, `medication_access_requests_*` policies all gate on `organization_id`/`patient_id = auth.uid()` matches, verified present by `rls-matrix.test.ts` and `wave2/3-rls.test.ts` | **Blocked** -- no authenticated cross-tenant probe has ever run against a live instance (`packages/runtime/src/live-database.test.ts`'s 8 tests are anonymous-denial only, and are skipped in this sandbox and never run by CI -- see `LAUNCH_GAP_MATRIX.md`'s G01 finding) |
| Storage access attempts (patient A reads patient B's prescription image) | New this session (PR #8): `prescriptions_bucket_read`/`prescriptions_bucket_insert` RLS on `storage.objects`, path-scoped via `storage.foldername(name)` to the uploader's own patient segment or staff role within the org -- content-asserted in `migration.test.ts`'s "prescription file storage migration" block | **Blocked** -- this bucket and its RLS have never been applied to a live Supabase instance at all (flagged explicitly in the migration itself and `PRESCRIPTION_INTAKE_CERTIFICATION.md`) |
| Inventory access (cross-org inventory read/write) | `inventory_batches`/`pharmacy_locations` covered by the same `rls-matrix.test.ts` discovery | **Blocked**, same live-execution gap |
| Reservation access (patient A views/cancels patient B's reservation) | `reservations_create` policy content-asserted (`wave2-rls.test.ts`/migration cert); no distinct read-policy content assertion found in this pass for a patient-scoped `reservations_read` -- **not independently re-verified in this document**, flagged for a follow-up read of the exact policy body | **Blocked** |
| Conversation access (staff of org X reading org Y's WhatsApp conversation) | `conversations_read` gates on `patient_id = auth.uid()` or `has_organization_role` within the conversation's own `organization_id`, content-asserted in `wave3-rls.test.ts` | **Blocked** |
| Privilege escalation (patient role calling a pharmacist-gated RPC) | Every RPC's `has_organization_role(...)` re-enforcement (see `CLINICAL_SAFETY_CERTIFICATION.md` item 3) means a patient-role JWT calling e.g. `decide_clinical_review` is rejected inside the function itself, independent of RLS -- this is defense-in-depth by design, not solely reliant on RLS | **Blocked** for live confirmation, but structurally the strongest-evidenced row in this table: the check is duplicated at the RPC layer, not solely dependent on a single RLS policy being correct |

## What "Blocked" means here, precisely

Every row above needs the same missing dependency: **a live Postgres/Supabase
instance with at least two seeded tenant organizations, each with a
patient and staff member, and an authenticated session per test identity**.
This is not a code gap -- the RLS policies and RPC-level checks exist and
are content-verified. It is a testing-infrastructure gap this sandbox
cannot close (no Docker/container-registry access to run `supabase start`,
per `docs/audit/RC1_SPRINT_REPORT.md` Phase 1, unchanged since first
recorded). The minimal unblocking action is provisioning that instance
(local `supabase start` in an environment with registry access, or a
disposable hosted project) and running the adversarial matrix above as a
real integration test suite -- not a source change.

## Recommendation

Given six of six adversarial scenarios are Blocked on the identical
missing dependency, the highest-leverage single action for G03 is not
writing more RLS policies (existing coverage is broad and
content-verified) -- it is provisioning one live test environment and
running the authenticated cross-tenant matrix once. That single action
would close G03's largest evidence gap, `SECURITY_CERTIFICATION.md`'s
"authenticated cross-tenant isolation assessment" requirement, and this
report's entire "Live verification" column in one pass.
