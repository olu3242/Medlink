# Medlink RC1 threat model

## Protected assets

Clinical and prescription data, tenant membership, patient identity, inventory
and reservation integrity, payment references, integration credentials,
conversation content, audit evidence, and availability of clinical workflows.

## Trust boundaries

- Browser or WhatsApp provider to versioned API/webhook boundary.
- Authenticated principal to tenant-scoped PostgreSQL RLS.
- API transaction to durable outbox and background consumers.
- Medlink to OCR, payment, FHIR/HL7, and approved partner providers.
- Runtime telemetry to immutable operational evidence.

## Primary threats and controls

| Threat | Required control |
|---|---|
| Cross-tenant access | Membership authorization plus RLS on every tenant table |
| Webhook forgery/replay | Timestamped signature and atomic event claim |
| Duplicate financial or inventory side effect | Tenant idempotency and atomic locking |
| Clinical automation overreach | Human review and prohibited AI state transitions |
| Secret disclosure | Vault references, source scanning, and production dependency audit |
| Message or event tampering | Append-only evidence and versioned contracts |
| Queue outage | Durable retry, dead letter, alerting, and replay runbook |
| Provider outage | Timeout, recovery, handoff, and health-based fail-closed behavior |
| Backup disclosure/corruption | Encryption and SHA-256/object-count restore verification |

## Release decision

High or critical production dependency findings, embedded credentials, missing
tenant isolation, failed restore integrity, or incomplete external conformance
block release.
