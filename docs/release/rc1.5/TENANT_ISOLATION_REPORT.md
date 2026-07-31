# RC1.5 Authenticated Tenant-Isolation Report

Decision: **SCOPED SOURCE PASS / PRODUCTION VALIDATION PENDING**

## Existing evidence

- Automated migration scan discovers every tenant-scoped table and requires
  explicit RLS policy or documented worker-only deny-by-default posture.
- Eight hosted anonymous probes return no rows while preserving schema access.
- Canonical request context requires tenant and organization agreement.
- Membership-backed authorization and portal RBAC tests pass.

## Required authenticated matrix

Create designated tenants A and B with patient, pharmacist, pharmacy,
tenant-admin, platform-admin, worker, and unauthenticated identities. For every
tenant table and protected API prove:

1. Same-tenant permitted action succeeds only for authorized roles.
2. Cross-tenant read, insert, update, delete, RPC, and object lookup fail closed.
3. Tenant identifiers in headers, body, query, event, and idempotency key cannot
   override authenticated context.
4. Audit/outbox/evidence records retain the correct tenant.
5. Background consumers and service-role paths enforce explicit tenant scope.
6. Cached, replayed, delayed, and concurrent requests do not leak data.

| Test identity/matrix | Result | Evidence SHA-256 |
| --- | --- | --- |
| Tenant A roles | Pending | Pending |
| Tenant B roles | Pending | Pending |
| Cross-tenant API/object/RPC attempts | Pending | Pending |
| Audit and event isolation | Pending | Pending |
| Worker/service-role isolation | Pending | Pending |

The report becomes PASS only after the complete authenticated matrix executes in
the release-equivalent environment and receives Security approval.

