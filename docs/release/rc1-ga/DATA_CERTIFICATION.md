# RC1 Data Integrity Certification

Date: 2026-07-30  
Baseline: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Decision: **CONDITIONAL**

| Requirement | Result | Evidence and gap |
| --- | --- | --- |
| Migration chain | PASS | Fourteen reviewed migrations apply in isolated CI and the configured hosted project. Subsequent dry-run reported no pending migrations. |
| Deterministic reconstruction | PASS | Two clean resets produced non-empty, byte-identical, SHA-256-hashed public-schema exports. |
| Rollback | Conditional | Forward-fix/rollback governance exists. Destructive and data-bearing rollback execution in a designated environment is not evidenced. |
| Transaction consistency | Source PASS | Runtime transaction, audit, outbox, reservation locking, and idempotency tests pass. Repository audit notes that every mutating use case still requires environment-backed confirmation of atomic behavior. |
| Referential integrity | Source PASS | Migration foreign keys, checks, unique constraints, state controls, and migration tests pass. |
| Tenant isolation | Scoped PASS | Source RLS matrix covers tenant tables; eight hosted anonymous probes deny rows without hiding schemas. Authenticated allow/deny cross-tenant fixtures remain pending. |
| Audit records | Source PASS | Audit/outbox records and retention/evidence contracts pass tests. Production retention and immutable archive verification remain pending. |
| Data restore | **OPEN** | Deterministic schema recovery is not a managed backup restore. No data/object-count restore artifact exists. |
| Schema drift | PASS at recorded check | Hosted dry-run reported up to date after migrations `202607270001`–`202607290014`. A fresh signed pre-GA drift check is still required at release time. |

## Release blockers

1. Managed encrypted backup and isolated data restore with integrity and object-count verification.
2. Authenticated cross-tenant RLS tests using designated test identities.
3. Approved rollback/forward-recovery exercise.
4. Data Operations and Compliance approvals.

