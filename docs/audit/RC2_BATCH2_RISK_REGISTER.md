# RC2 Batch 2 Risk Register

Date: 2026-07-31  
Status: Open until representative runtime validation

| ID | Description | Impact | Likelihood | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| B2-R01 | Migrations `020` and `021` have not run against an isolated RC2 Supabase project in this environment. | High | Medium | Clean apply, recovery and authenticated RLS evidence before pilot. | Data/Release | Open |
| B2-R02 | Stock concurrency and idempotency are proven statically/unit-level only. | High | Medium | Run simultaneous stock commands and failure injection; reconcile batch, ledger, audit and outbox. | Pharmacy Engineering | Open |
| B2-R03 | Expiry worker scheduling and secret delivery are deployment-owned. | High | Medium | Store a dedicated server-only token, run bounded canaries, alert on stale expired stock and rehearse rotation. | Platform Operations | Open |
| B2-R04 | Price/currency and pharmacy-location behavior lacks authenticated acceptance evidence. | Medium | Medium | Seed pilot currency/location cases and verify role, version and cross-tenant denials. | Pharmacy Operations | Open |
| B2-R05 | Signed prescription-source access is not validated with a real storage service. | High | Medium | Validate short expiry, authorized review access, cross-tenant denial and safe referrer/log behavior. | Security/Clinical | Open |
| B2-R06 | Canonical corrections could be clinically unsafe if operator workflow or catalogue data is wrong. | Critical | Low | Verified pharmacist only, active catalogue only, explicit per-item confirmation, append-only evidence and no automatic substitution. | Clinical Governance | Mitigated; validate |
| B2-R07 | Clarification content is sensitive and replay/visibility must remain tightly scoped. | High | Low | RLS-protected storage, no text in logs/outbox, content-bound idempotency and patient/pharmacist participant tests. | Security/Clinical | Mitigated; validate |
| B2-R08 | Low/expiring alerts have no deployed schedule/notification evidence. | Medium | Medium | Validate dashboard queries, expiry schedule, alert thresholds and operational response through the runbook. | Pharmacy Operations | Open |

No risk is accepted by this document. Acceptance requires the authorized
governance process and an evidence-linked approver.
