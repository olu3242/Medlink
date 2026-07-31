# RC1 Security Certification

Date: 2026-07-30  
Baseline: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Decision: **CONDITIONAL / NOT PRODUCTION CERTIFIED**

## Evidence

| Control | Result | Evidence and remaining requirement |
| --- | --- | --- |
| Secret management | Conditional | Public runtime variables are schema-validated and repository CI uses Actions secrets. The local `.env.example` modification is explicitly excluded from release content. Independent secrets review and production vault/rotation evidence remain pending. |
| Environment isolation | Conditional | Environment registry and deployment contracts exist. Production/pre-production parity and environment-isolation execution evidence remain pending. |
| RBAC | Source PASS | Canonical request context, role authorization, portal RBAC tests, and administrative endpoint restrictions pass automated tests. Deployed authorization assessment remains pending. |
| JWT lifecycle | Conditional | Supabase verifies users server-side through `auth.getUser()`. Token expiry, revocation, refresh, and compromised-session exercises are not evidenced. |
| Audit integrity | Source PASS | Transactional audit/outbox schema, certification evidence contracts, retention policies, and automated tests pass. Live immutable-retention review remains pending. |
| Rate limiting | **OPEN** | No repository evidence demonstrates application or edge rate limiting for public routes and authentication endpoints. Deployment-layer evidence or an approved remediation is required. |
| Security headers | **OPEN** | Correlation middleware is present, but an approved production header policy and deployed verification for CSP, HSTS, frame, MIME, and referrer controls are not evidenced. |
| Session management | Conditional | Supabase SSR cookie refresh is implemented. Deployed cookie attributes, logout/revocation, fixation, and inactivity controls require assessment. |
| RLS enforcement | Scoped PASS | Complete source policy matrix and eight hosted anonymous-denial probes pass. Authenticated cross-tenant identities and independent multi-tenant isolation verification remain pending. |
| Dependency security | **OPEN** | The locked tree reports 15 high findings. See `DEPENDENCY_RISK_REGISTER.md`. |
| Penetration assessment | **OPEN** | Threat model and source security tests exist; no authorized independent deployed-target report or remediation sign-off exists. |

## Required closure evidence

1. Independent application/API/infrastructure penetration report and remediation sign-off.
2. Production secrets, session, JWT, rate-limit, and security-header verification.
3. Authenticated cross-tenant isolation assessment.
4. Approved disposition of the production PostCSS and optional Sharp findings.
5. Security Lead approval linked to the immutable RC1 package.

The repository threat model explicitly makes high production dependency findings,
missing tenant isolation, and incomplete external conformance release blockers.

