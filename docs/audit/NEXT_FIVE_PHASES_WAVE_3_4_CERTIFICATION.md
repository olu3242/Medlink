# Wave 3/4 — Next Five Phases Certification

Date: 2026-07-29

## Scope

This record covers RC1 backlog items 19–23:

1. Integrated fulfillment, inventory compensation, pickup, handoff, and notification.
2. Replay, outage, recovery, concurrency, ordering, and end-to-end workflow tests.
3. Professional API contracts required by pharmacy, pharmacist, and provider portals.
4. Professional-first portal architecture with optional patient-web fallback.
5. Health-checked, idempotent operational adapters for enterprise capabilities.

## Evidence

- The fulfillment coordinator advances durable stages with optimistic
  concurrency, ordered notifications, replay-safe compensation, and human
  handoff during inventory outages.
- The professional operation catalog assigns explicit permissions and roles to
  inventory, reservation, review, and provider operations.
- The provider role is introduced in an isolated enum migration before its use
  by fulfillment RLS.
- Required RC1 portals are professional-facing; the patient web application is
  retained as an optional conversation-channel fallback.
- Payment, adherence, analytics, reporting, AI, governance, partner,
  security, and certification adapters share health, journal, tenant,
  correlation, and idempotency contracts.

## Certification status

Source certification: **PASS**, subject to the accompanying validation run.

Final runtime certification remains conditional on applying migrations,
deploying the professional routes, and exercising configured provider adapters.
