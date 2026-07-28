# ADR 0002: WhatsApp-first conversation architecture

## Status

Superseded by ADR 0003, Conversation-Driven Architecture.

## Context

Patients are expected to use WhatsApp as their primary MedLink experience.
Pharmacists, pharmacies, hospitals, and administrators require richer web
interfaces. Treating WhatsApp as a later notification adapter would put workflow
logic in the wrong channel and make future SMS, USSD, mobile, and partner
experiences difficult to add safely.

## Decision

MedLink is an API-first, WhatsApp-first platform.

Patient workflows are coordinated by a dedicated Conversation Orchestration
Engine. The engine manages session state, intent, multi-turn workflow context,
human handoff, notifications, and audit events. It invokes versioned domain APIs
for clinical review, medicine matching, inventory, pharmacy discovery,
reservation, payment, and fulfillment.

The WhatsApp integration is a thin channel adapter. It verifies webhooks,
normalizes provider payloads, transfers media, delivers responses, and maps
provider failures. It contains no domain business rules.

Professional web portals consume the same APIs. They are operational and
clinical interfaces, not the primary patient application.

## Safety and reliability constraints

- No conversation or channel component may approve a clinical decision,
  medicine substitution, or MAR transition.
- Pharmacist review and acknowledgement requirements remain enforced by domain
  services and database policy.
- Inbound messages use verified signatures, replay protection, idempotency keys,
  and durable ordering metadata.
- Conversation and handoff state is tenant-scoped, resumable, and auditable.
- Sensitive message and media content follows explicit consent, retention,
  redaction, and expiry policies.
- Provider retries, duplicates, delays, and outages must not duplicate
  reservations, payments, inventory locks, or clinical actions.

## Consequences

Wave 3 prioritizes the WhatsApp patient MVP. Professional portals move to Wave
4. Existing patient web code may remain as an accessibility or fallback surface,
but it cannot define workflow rules or be required to complete the RC1 patient
journey.

SMS, USSD, native mobile, and other channels are post-RC1 candidates that reuse
the same orchestration and domain APIs.
