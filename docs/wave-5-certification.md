# [HISTORICAL / PRE-CDA] Wave 5 certification — Enterprise and Scale

> **This document predates the Conversation-Driven Architecture pivot.**
> The current Wave 5 ("Enterprise Services" per `docs/release-scope.md`)
> substantially overlaps with what's described here, but "durable workflows"
> is now Wave 3 (Workflow Orchestrator) scope, not Wave 5. Kept for its
> still-relevant enterprise invariants, not as current status. Closes
> `docs/audit/RC1_BACKLOG.md` P0 item 5.

Wave 5 adds integrations, governance, reporting, security, certification,
durable workflows, and the developer portal.

## Enterprise invariants

- FHIR/HL7 and partner integrations use typed adapter boundaries.
- Webhooks require timestamped signatures and atomic replay claims.
- Governance, consent, incident, workflow, and security histories are append-only.
- Reports are aggregate-only and suppress small cohorts.
- API credentials are stored only as strong hashes; integration secrets use
  vault/KMS references and are never returned by the portal.
- Every enterprise record remains tenant-scoped under RLS.

## Certification status

- [x] Domain unit tests
- [x] Strict TypeScript checks
- [x] Developer portal production build
- [x] Versioned migration with RLS and immutable trails
- [x] Security-oriented secret and identifier constraints
- [ ] Migrations executed against PostgreSQL
- [ ] External FHIR/HL7/HMO conformance environments connected
- [ ] Load, penetration, backup, and disaster-recovery exercises

Unchecked checks require deployment infrastructure or external partner systems
and cannot be certified by a source-only build.
