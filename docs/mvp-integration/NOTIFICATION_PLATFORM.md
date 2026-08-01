# Notification Platform

RC1 is WhatsApp-first. Workflow events create notifications for confirmation, needs-information, review completion, reservation creation, and expiration. `NotificationService` chooses a configured channel and deduplicates sends with an idempotency key. Provider identifiers and outcomes are recorded for audit. Email is optional; SMS, USSD, and independent notification workflows are outside scope.
