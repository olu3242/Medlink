# Notification Platform

RC1 is WhatsApp-first. Workflow events create notifications for confirmation, needs-information, review completion, reservation creation, and expiration. `NotificationService` chooses a configured channel and deduplicates sends with an idempotency key. Provider identifiers and outcomes are recorded for audit. Email is optional; SMS, USSD, and independent notification workflows are outside scope.

## Reservation lifecycle notifications (G09)

`packages/notifications/src/reservation-outbox.ts` drains `runtime_outbox_events` for `reservation.{confirmed,cancelled,ready,collected}.v1`, resolving the recipient patient from the reservation row and sending via WhatsApp. The READY template never contains the pickup credential -- see `docs/mvp-integration` pickup-credential notes and `supabase/migrations/202608160035_pickup_credential_authority.sql`. No consumer is registered for `reservation.credential_issued.v1`, so credential issuance cannot reach WhatsApp even structurally.

Dispatch has two independent triggers: every reservation route (`apps/patient`'s create route, `apps/pharmacy`'s decide/ready/collect routes) fires a best-effort dispatch after its own successful response, and `POST /api/internal/notification-dispatch` (apps/web, bearer-token-protected via `MEDLINK_NOTIFICATION_WORKER_TOKEN`, same pattern as `/api/internal/inventory-expiry` and `/api/internal/clinical-pipeline`) exists so an external scheduler can advance the queue during quiet periods with no reservation traffic. This repository has no in-process cron; operations must schedule that endpoint externally for production.
