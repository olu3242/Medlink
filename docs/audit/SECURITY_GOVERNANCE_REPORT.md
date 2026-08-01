# Security Governance Report (Engine 64)

Synthesis of every security-relevant finding across this session's
certification program (`LAUNCH_GAP_MATRIX.md`, `WHATSAPP_RUNTIME_CERTIFICATION.md`,
`PRESCRIPTION_INTAKE_CERTIFICATION.md`, `MULTITENANT_SECURITY_REPORT.md`,
`docs/release/rc1-ga/SECURITY_CERTIFICATION.md`), reclassified into one
consistent Critical/High/Medium/Low scale with remediation guidance. No
new scanning was performed for this document -- it is a reclassification
and consolidation pass, not a fresh audit.

## Classification key

- **Critical**: exploitable data exposure or clinical-safety bypass;
  blocks pilot.
- **High**: real risk requiring resolution before broader rollout; does
  not necessarily block a small, controlled pilot.
- **Medium**: real gap, low immediate exploitability, should be scheduled.
- **Low**: hygiene/process issue, no direct exploit path identified.

## Findings

| Severity | Finding | Evidence | Remediation |
| --- | --- | --- | --- |
| Critical | Zero live authenticated cross-tenant isolation proof (all 6 adversarial scenarios Blocked) | `MULTITENANT_SECURITY_REPORT.md` | Provision one live test environment, run the named adversarial matrix once -- closes this and the inventory-concurrency Critical below in the same pass |
| Critical | Inventory-reservation race under real concurrency never proven | `FAILURE_TEST_MATRIX.md` | Same live environment; write the two-concurrent-connection test the failure matrix already specifies precisely |
| High | Rate limiting: no application or edge evidence for public/auth routes | `SECURITY_CERTIFICATION.md` | Deployment-layer control (edge/WAF) or application middleware; not a code-architecture change |
| High | Security headers (CSP, HSTS, frame, MIME, referrer): no approved production policy or deployed verification | `SECURITY_CERTIFICATION.md` | Define and deploy a header policy; verify against the deployed target, not source alone |
| High | JWT/session lifecycle (expiry, revocation, refresh, compromised-session) unevidenced | `SECURITY_CERTIFICATION.md`, `FAILURE_TEST_MATRIX.md`'s invalid-JWT/expired-session rows | Add unit tests for the `authenticate()` failure-mapping path (achievable without live infra, per `FAILURE_TEST_MATRIX.md`'s own note), then live verification |
| High | `clinical_findings` has no immutability guard, unlike every comparable audit table | `CLINICAL_SAFETY_CERTIFICATION.md` item 4 | One migration adding the same `prevent_enterprise_event_mutation()` trigger pattern already used 20+ times elsewhere in this schema |
| High | `npm audit`: 3 high-severity findings (PostCSS path traversal, `sharp` libvips CVEs, both inherited via `next`) | `LAUNCH_GAP_MATRIX.md` (corrects a stale "15 high" figure in `DEPENDENCY_RISK_REGISTER.md`) | Requires a `next` major-version bump; `DEPENDENCY_AUDIT.md`'s existing per-package risk assessment already recommends a lowest-risk-first order -- re-run `npm audit` against the exact production lockfile before scheduling |
| Medium | `OutboxDispatcher` (retry/dead-letter) has zero tests and zero live callers | `FAILURE_TEST_MATRIX.md` | Add unit tests for the retry/dead-letter transition; wire a real caller once G09 exists |
| Medium | Missing-tenant (`TenantContextError`) and database-timeout failure paths have no test coverage | `FAILURE_TEST_MATRIX.md` | Both explicitly named as closable *without* live infrastructure -- the cheapest security-hardening item in this entire report |
| Medium | Two historical leaked credentials (Supabase anon-key JWT, DB password) | Confirmed confined to `fix/rc1-readiness` commit `9a5686e`, not reachable from `main`, found and reported earlier this session | Rotate both regardless of branch disposition -- a leaked credential remains leaked even if the commit exposing it is never merged |
| Medium | `apps/web`/`packages/api` independently reimplement the same runtime lifecycle | `RC1_BACKLOG.md` item 1, `ENGINEERING_GOVERNANCE.md` | Not itself a vulnerability, but two independent implementations of an authentication/authorization pipeline is a place drift could silently reintroduce a gap one copy fixes and the other doesn't -- consolidate under an ADR |
| Low | `DEPENDENCY_RISK_REGISTER.md`'s stale finding count | `LAUNCH_GAP_MATRIX.md` | Re-run and republish |
| Low | ADR 0004/0005 numbering collision | `ADR_CONFORMANCE_REPORT.md` | Documentation-only fix, no security exposure, listed here only for completeness of this program's full finding set |

## What is NOT a finding (verified, not assumed)

- **RBAC**: source-complete, 100%-covered, re-enforced independently at
  every RPC layer in addition to RLS -- no gap identified anywhere in
  this program's review.
- **Storage authorization** (new this session, PR #8): correctly scoped
  RLS on `storage.objects`, mirroring the existing `prescriptions_read`/
  `prescriptions_create` pattern exactly -- source-certified, pending the
  same live-execution evidence every other RLS policy in this table needs.
- **Secret handling in new code**: PR #6 and #8 both introduce new
  server-only environment variables (`SUPABASE_SERVICE_ROLE_KEY`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) -- all documented in
  `.env.example` with placeholder values only, never committed as real
  values, verified by this session's own git-history secret scan.
- **Audit logging**: certified across the board (`CLINICAL_SAFETY_CERTIFICATION.md`
  item 3, `ARCHITECTURE_CONFORMANCE_FINAL.md`'s "never mutate business
  state without audit/evidence" row) -- every atomic RPC this program
  touched commits evidence in the same transaction as the state change.

## Verdict

**Two Critical findings, both blocking a pilot, both closable by the
identical single action** (a live test environment) already named in
`FINAL_GO_NO_GO.md`. Five High findings, none requiring new architecture
-- three are deployment/policy configuration (rate limiting, headers, JWT
lifecycle test coverage), one is a single migration
(`clinical_findings`), one is a dependency upgrade already scoped
elsewhere. No finding in this report was newly discovered by this
program beyond the `clinical_findings` gap (found in Batch 4) and the ADR
numbering collision (found in this batch) -- this document's contribution
is consolidation into one severity scale and remediation list, not new
scanning.
