# RC2 PI-1 Risk Register

Date: 2026-07-30  
Status: Open until representative-environment validation

| ID | Description | Impact | Likelihood | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PI1-R01 | Migration `017` has not run in an isolated RC2 Supabase project in this environment. | High | Medium | Apply forward-only migration, capture output, run tenant/RLS and replay scenarios before pilot. | Data/Release | Open |
| PI1-R02 | OCR/parser provider credentials and production behavior are not available for live validation. | High | Medium | Use approved secret store, provider canary documents, contract tests, rate limits, and failure drills. | Platform/AI | Open |
| PI1-R03 | Verified pharmacist profile and license lifecycle need representative operational data. | High | Medium | Provision test pharmacist through approved admin process and validate active, suspended, expired, and cross-tenant cases. | Clinical Operations | Open |
| PI1-R04 | Worker scheduler/concurrency configuration is deployment-owned. | Medium | Medium | Start with batch one, alert on queue age/retries/expired leases, and scale gradually using the runbook. | Platform Operations | Open |
| PI1-R05 | Authenticated UI screenshots and accessibility evidence require a seeded environment. | Medium | Medium | Execute four-persona pilot acceptance, keyboard/screen-reader checks, and archive screenshots after deployment. | QA/UX | Open |
| PI1-R06 | Service role and provider tokens could be exposed by deployment misconfiguration. | Critical | Low | Server-only variables, dedicated worker bearer, secret scanning, rotation, and no secret/URL logging. | Security | Mitigated; validate |
| PI1-R07 | Provider output can be malformed or clinically ambiguous. | High | Medium | Strict bounded schemas, confidence findings, immutable source evidence, fail closed, and mandatory pharmacist review. | Clinical/Engineering | Mitigated |
| PI1-R08 | Duplicate or stale workers could write conflicting outcomes. | High | Low | `SKIP LOCKED`, expiring fenced leases, exact replay checks, unique keys, atomic completion, and dead letters. | Engineering | Mitigated; validate |

No open risk is accepted by this document. Risk acceptance requires the
authorized governance process and evidence-linked approver record.

Batch 2 review-resolution, clarification and inventory risks are tracked in
`RC2_BATCH2_RISK_REGISTER.md`; this PI-1 register remains authoritative for the
scanner/OCR/parser pipeline.
