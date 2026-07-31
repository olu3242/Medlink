# [HISTORICAL / PRE-CDA] Wave 4 certification — Experience and Intelligence

> **This document predates the Conversation-Driven Architecture pivot and
> does not describe the current Wave 4.** The current Wave 4 is
> "Professional Portals" (pharmacy, pharmacist, hospital, administrator) per
> `docs/release-scope.md`; this file describes an earlier "notification/
> payment/adherence/analytics/AI + dashboard/provider" grouping that has
> since been redistributed — those domain packages are now Wave 5 scope, and
> `apps/dashboard`/`apps/provider` are unstarted UI scaffolds with no backing
> routes (see `docs/audit/RC1_BACKLOG.md`). Kept for its still-relevant
> safety/privacy invariants, not as current status. Closes
> `docs/audit/RC1_BACKLOG.md` P0 item 5.

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
