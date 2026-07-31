# RC1.5 Dependency Acceptance Register

Decision: **NOT ACCEPTED**

The detailed inventory is maintained in
`../rc1-ga/DEPENDENCY_RISK_REGISTER.md`. Exact installation reports 15 high and
zero critical findings. No package upgrade is authorized by this register.

| Risk group | Proposed disposition | Remediation release | Accountable approval |
| --- | --- | --- | --- |
| Twelve ESLint/Vitest/glob development-toolchain entries | Temporary acceptance only if CI inputs and contributors remain controlled | Approved maintenance release | Pending Security and Engineering signatures |
| Next aggregate entry | Do not accept independently; disposition follows PostCSS/Sharp | Approved maintenance release | Pending |
| PostCSS production/build path | Validate non-breaking patched resolution or framework remediation; otherwise signed time-bounded exception | Approved RC1 maintenance release | Pending Security signature |
| Optional Sharp production path | Prove omission in deployed profile or remediate compatibly; constrain untrusted image processing | Approved RC1 maintenance release | Pending Security and Operations signatures |

## Required acceptance fields

For each accepted item record approver, rationale, compensating controls,
environment scope, expiry, planned version/release, monitoring trigger, evidence
SHA-256, and signature. Missing or expired acceptance fails closed.

