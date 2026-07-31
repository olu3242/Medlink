# RC1 Exercise Reports

Date: 2026-07-29

| Exercise | Source evidence | Environment evidence |
|---|---|---|
| Load/performance | 100 runtime lifecycle operations complete under the 1s source baseline | Production-like sustained load pending |
| Penetration | Threat model, RBAC/RLS tests, webhook forgery/replay controls, source rules | Authorized deployed-target penetration pending |
| Backup | CI run 25 creates a non-empty isolated schema export, checks required schema content, computes SHA-256, and deletes the temporary file | Managed encrypted database backup artifact pending |
| Restore | CI run 27 proves byte-identical schema reconstruction across two clean resets with non-empty SHA-256-hashed exports | Managed data restore with object-count verification pending |
| Disaster recovery | Complete exercise result required by certification suite | Regional/provider failover exercise pending |

No pending environment exercise is represented as completed.
