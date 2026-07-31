# RC1 Reliability Certification

Date: 2026-07-30  
Baseline: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Decision: **CONDITIONAL**

| Requirement | Result | Evidence and gap |
| --- | --- | --- |
| Startup | PASS | Production build starts and `/`, `/health/live`, `/health/ready`, and `/api/v1/health` return HTTP 200 with configured network access. |
| Shutdown | Conditional | CI performs orderly Supabase shutdown. Production application termination/drain behavior is not exercise-backed. |
| Recovery | Source PASS | Recovery contracts, deterministic schema reconstruction, runbooks, and certification tests pass. Managed data recovery remains pending. |
| Retry | Source PASS | Runtime transaction retry and outbox exponential-backoff behavior are tested. Provider-specific production retry evidence remains pending. |
| Idempotency | Source PASS | Runtime, workflows, reservations, medication access, notifications, and outbox use stable idempotency boundaries with automated tests. |
| Dead-letter queues | Source PASS | Missing or exhausted consumers dead-letter and repository runbooks cover replay. Production alert/replay exercise remains pending. |
| Timeout propagation | Conditional | Runtime and provider contracts define bounded timeout/recovery behavior. Deployed provider timeout exercises are pending. |
| Health monitoring | PASS for startup/readiness | Dependency-aware health aggregation is fail-closed. The earlier 503 was reproduced as an execution-environment `EACCES`; unchanged RC1 returned 200 when outbound Supabase access was permitted. |
| Performance/SLA | **OPEN** | Source performance smoke passes; production-like sustained load, SLA, and capacity evidence have not been executed. |
| Hypercare | **OPEN** | Contracts and exit criteria exist; no production stabilization interval or signed exit evidence exists. |

## Validation summary

- Lint: PASS
- Strict TypeScript: PASS
- Engineering tests: 280 PASS
- Hosted database/RLS tests: 8 PASS
- Application builds: 8 PASS
- Production HTTP smoke: 4/4 PASS

Reliability cannot be marked production-certified until shutdown/drain, load,
provider-failure, recovery, monitoring/alerting, and hypercare evidence is
captured in the designated environment.

