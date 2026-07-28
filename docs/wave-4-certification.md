# Wave 4 certification — Experience and Intelligence

Wave 4 adds notification, payment, adherence, analytics, and AI domain packages,
plus patient dashboard and provider applications.

## Safety and privacy invariants

- Payment boundaries accept provider tokens only; no card numbers are modeled.
- Analytics suppress cohorts below the configured privacy threshold.
- AI outputs always require human review and cannot transition an MAR or make a
  clinical decision.
- Notification, payment, adherence, analytics, and AI writes are tenant-scoped,
  idempotent, and auditable.
- Population-health reads are aggregate-only.

## Verification

- [x] Focused domain unit tests
- [x] Independent dashboard and provider production builds
- [x] Responsive, accessible API-consuming applications
- [x] RLS, immutable event, idempotency, and index migration
- [ ] Runtime migration and provider-adapter integration tests
