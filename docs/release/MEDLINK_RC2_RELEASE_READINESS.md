# MedLink RC2 Agentic MVP — Release Readiness

Canonical base: `main` @ `c1b5100d2c5f503379de4392f575468c02d32dab`.
Certified implementation head: `f6d15c0d14b8c309760077f448b1bb50fbf4f384`.
Publication: draft PR #31, `feat/rc2-agentic-mvp-e2e-convergence`.

This is the canonical RC2 repository-readiness record. It does not certify a
real Meta provider or a full WhatsApp prescription-to-collection transaction.

## Certified repository scope

- Authenticated browser lifecycle: patient prescription/MAR → pharmacist
  review → patient availability/match/reserve → pharmacy confirm/ready →
  patient pickup credential → pharmacy rejection of a wrong credential →
  collection. Final reservation is `collected`; inventory lock is `consumed`.
- Canonical medicine identity remains the transactional UUID across catalog,
  prescription, MAR, review, availability, matching, inventory, reservation,
  and collection. Greenbook product IDs and NRNs remain source evidence only.
- Three independent Supabase-authenticated browser personas, tenant isolation,
  RLS/GRANT enforcement, idempotency, audit/evidence, outbox independence,
  expiry, and final-stock/collection concurrency.
- Governed agents retain registered identity/version, authorized capabilities,
  policy checks, workflow boundaries, tenant/correlation propagation, denied
  capability behavior, human review, and persisted execution evidence.
- Signed WhatsApp webhook identity, conversation persistence, governed medicine
  search, duplicate delivery handling, provider timeout/error mapping, ordered
  delivery, and provider contract simulation.
- Deterministic migration replay, security audit, recovery gates, all application
  builds, health/readiness, and backup/restore transaction-state validation.

## Executed evidence

| Gate | Result |
|---|---|
| PR #31 CI | 10/10 jobs passed on implementation head |
| Browser medication golden loop | 1/1 passed, zero retries; CI transaction 13.063s |
| Browser authentication | 9/9 passed; two OTP-cooldown retries documented |
| Live database / RLS / concurrency | 23/23 passed |
| Unit/static | 845 passed; 41 intentional skips |
| Python | 12/12 passed |
| Agent governance | 63/63 passed |
| WhatsApp/provider and conformance | 45/45 and 14/14 passed |
| Security | 78/78 passed; zero high-severity npm findings |
| Recovery | 23/23 passed |
| Migrations | 74 deterministic migrations replayed locally; CI apply/recovery passed |
| Builds | 8/8 applications passed |
| Health | `/health/live` 200; `/health/ready` 200 |
| Backup/restore | Restored transaction state validated |

The CI golden fixture used canonical medicine
`c13d918b-405b-417a-ade4-eb45f34c998e`, MAR/workflow
`9a814b80-cd01-45f5-9268-539403003b86`, reservation
`c32d4c9e-c928-49a6-acb9-c5a7f32e0b31`, inventory lock
`46f8137c-da04-49ae-98d2-88997ffd0bab`, and conversation
`27c9d66c-94cd-470b-9769-07eab01ebae3`.

## WhatsApp certification levels

1. **Channel/provider contract — certified.** Signed webhook and local provider
   conformance are covered by the 45-test and 14-test gates.
2. **Signed medication search — certified.** A linked identity can persist a
   conversation and execute the governed canonical medicine-search workflow.
3. **Full WhatsApp transaction — not certified.** Channel-side prescription/MAR,
   pharmacist handoff, reservation, pharmacy confirmation/ready, patient pickup
   credential authority, and collection are not wired end to end.

Repository audit: identity resolution, conversation persistence, workflow
creation/resume, and canonical medicine search are implemented and certified.
Persona authorization is bounded to the linked MedLink identity and membership,
not phone number alone. Prescription/MAR, clinical handoff, reservation,
confirmation, ready/credential, and collection are missing from the channel
path. Existing domain notifications and recovery remain reusable but do not
constitute a Level 3 channel transaction.

## MERDP freeze

No MERDP or NAFDAC acquisition code changed. Frozen evidence remains 9,008
products, 8,994 canonical medicines, 5,429 certified/published, 1,389
manufacturers, 11,707 relationships, 2,700 off-list evidence, and zero unsafe
NRN merges. No source reacquisition was performed for publication.

## Deployment, rollback, and external requirements

No production deployment or migration was performed. Deployment requires the
documented Supabase, worker, and WhatsApp environment values plus external
scheduling of internal workers. Readiness must remain healthy before traffic.
Rollback is the normal immutable application rollback paired with the repository
migration/recovery procedures; do not rewrite or down-migrate certified history.

Real Meta sandbox certification requires separately authorized credentials and
safe sandbox traffic. No access token or phone-number ID was available during
RC2 certification. This is an `EXTERNAL_INTEGRATION_BLOCKER` for real-provider
certification, not for repository or browser medication-loop certification.

## Known debt and next bounded execution

- Two browser-auth tests depend on the configured single retry because local
  GoTrue rejects immediate repeated OTP requests for the same fixture address.
- GitHub warns that v4 JavaScript actions target deprecated Node.js 20 and are
  currently forced onto Node.js 24; this is non-blocking CI maintenance debt.
- After merge authorization and canonical-main synchronization, the next bounded
  slice is full WhatsApp medication transaction certification using the existing
  identity, workflow, clinical, reservation, fulfillment, and audit systems.

PR #31 must not be merged without explicit authorization.
