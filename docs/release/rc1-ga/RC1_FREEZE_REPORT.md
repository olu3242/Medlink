# RC1 Release Freeze Report

Date: 2026-07-30  
Certified baseline: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Immutable tag: `v1.0.0-rc1`  
Freeze status: **ACTIVE**

## Integrity checks

- Certified source diff, excluding `.env.example`: zero.
- Uncommitted production code: none.
- Schema changes in this sprint: none.
- API changes in this sprint: none.
- Dependency changes in this sprint: none.
- Production LOC changes in this sprint: zero.
- `.env.example` remains a documented, unstaged local exclusion and must never
  be included in a release commit while it contains environment-specific data.
- Hosted migration dry-run was previously recorded as up to date; a signed
  release-time drift check remains required before deployment.

## Freeze policy

Allowed: certification documents, evidence references, CI maintenance, required
security remediation, and critical fixes preserving certified behavior.

Blocked: Engines 36–40, new features, unrelated schema/API changes, dependency
upgrades without approval, and architectural refactoring.

The `fix/rc1-readiness` branch contains no source change from the tag and is not
a hotfix release.

