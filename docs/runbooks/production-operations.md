# Production Operations Runbook Registry

This registry defines the mandatory RC1 operational runbook set. Each executable
runbook must contain purpose, scope, prerequisites, required permissions,
execution steps, expected results, validation, rollback, evidence, approval, and
revision history. Only an `approved` version may guide production work.

| Category | Owner | Required evidence |
| --- | --- | --- |
| Deployment | Release Operations | Approval, deployment, smoke, health |
| Rollback | Release Operations | Authorization, reason, restored version |
| Database Recovery | Database Operations | Restore log, integrity check, RTO/RPO |
| Disaster Recovery | Continuity Lead | Failover, regional health, acceptance |
| Provider Failure | Integration Operations | Provider health, failover, recovery |
| Inventory Failure | Pharmacy Operations | Reconciliation and consistency |
| Clinical Escalation | Clinical Lead | Case timeline and clinical acceptance |
| Authentication Failure | Identity Operations | Access impact and recovery |
| Tenant Recovery | Tenant Operations | Tenant-scoped validation and isolation |
| Security Incident | Security Officer | Incident record and containment |
| Data Restore | Data Operations | Restore scope, authorization, integrity |
| Certificate Rotation | Security Operations | Rotation and connectivity validation |
| Provider Onboarding | Integration Operations | Conformance certification |
| Tenant Onboarding | Tenant Operations | Isolation and access certification |
| Pharmacy Onboarding | Pharmacy Operations | Workflow and inventory acceptance |

## Execution controls

1. Confirm the current approved version and authorization.
2. Record the incident, change, deployment, or exercise identifier.
3. Execute through the owning platform or provider.
4. Capture immutable evidence in the certification artifact repository.
5. Validate expected results and tenant isolation.
6. Roll back on any mandatory validation failure.
7. Record human approval before closure.

AI guidance is advisory. It cannot execute deployment, recovery, identity,
security, provider, or data operations.
