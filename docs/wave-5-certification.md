# Wave 5 certification — Enterprise and Scale

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
