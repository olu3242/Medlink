# MedLink release scope

## RC1 scope boundary

RC1 consists exclusively of the five defined implementation waves, reprioritized
around a Conversation-Driven Architecture (CDA), with WhatsApp as the first
patient channel:

1. Wave 1 — Platform Foundation
2. Wave 2 — Clinical Intelligence
3. Wave 3 — Conversation Platform (Primary MVP)
4. Wave 4 — Professional Portals
5. Wave 5 — Enterprise Services and Production Certification

Waves 6–10 are not part of the repository roadmap and must not be invented.
Except for WhatsApp, capabilities described by the PRD for later rollout phases
remain product direction rather than current implementation requirements.

Any newly discovered work must be classified as one of:

- **RC1 Backlog** — required to satisfy an existing Wave 1–5 invariant or
  certification criterion.
- **RC2 Roadmap** — a future enhancement that expands product capability,
  geography, channels, integrations, or scale.

## Wave isolation

Platform Convergence S01.6–S01.10 is mandatory Track A work and contains no
feature delivery. Waves 2–5 are Track B and cannot begin until Track A is
certified.

A wave may consume certified artifacts from earlier waves but cannot implement
responsibilities assigned to a later wave. Only inert contracts and extension
points may be prepared for later integration. The owning wave implements and
certifies the behavior.

## Channel strategy

- **Primary patient channel:** WhatsApp conversational interface.
- **Primary professional channels:** web portals for pharmacists, pharmacies,
  hospitals, and administrators.
- **System of Engagement:** WhatsApp and professional portals provide
  replaceable user-facing channels.
- **System of Record:** domain engines and tenant-scoped data remain the sole
  source of business truth.
- **System boundary:** every channel and professional portal consumes the same
  versioned API layer.
- **Future channels:** SMS, USSD, mobile applications, and partner clients reuse
  the conversation and domain APIs without duplicating business logic.

The patient journey is conversation-first: onboarding and OTP verification,
prescription upload, clinical review, medicine and pharmacy selection,
reservation, and pickup or delivery status. A patient must be able to complete
the RC1 journey without visiting a website.

## RC1 wave outcomes

### Wave 1 — Platform Foundation

Shared identity, tenant isolation, API conventions, database contracts,
observability, and platform policy.

### Wave 2 — Clinical Intelligence

Medicine knowledge, equivalency, prescription extraction, clinical validation,
and mandatory pharmacist review boundaries.

### Wave 3 — Conversation Platform (Primary MVP)

- User onboarding and OTP verification
- Prescription image and PDF upload
- Medicine search and brand-to-generic lookup
- Pharmacy discovery and selection
- Reservation workflow
- Consultation and pharmacist handoff
- Status notifications and pickup QR delivery
- Conversation Engine for dialogue, sessions, intent, context, handoff, and
  delivery handling
- Workflow Orchestrator for durable, channel-neutral business processes
- Canonical workflow contracts for search, prescription, MAR, consultation,
  reservation, pickup, follow-up, and refill journeys
- Versioned domain events and transactional publication

### Wave 4 — Professional Portals

- Pharmacy portal
- Pharmacist dashboard
- Hospital portal
- Administration dashboard

These interfaces provide operational depth while using the same API and domain
contracts as the patient conversation.

### Wave 5 — Enterprise Services

Analytics, integrations, governed AI enhancements, security, governance,
certification, and public or partner APIs.

## Conversation-Driven Architecture

The Conversation Engine is an RC1 platform component. It owns:

- Session management and channel identity binding
- Conversation state and multi-turn workflow coordination
- Intent detection and context preservation
- Human handoff and resumable conversations
- Delivery receipts and notification coordination
- Append-only interaction and decision audit trails

The Conversation Engine manages dialogue and owns no clinical, inventory,
pricing, reservation, or payment rules. It delegates durable business processes
to the Workflow Orchestrator. Workflows invoke the same versioned APIs used by
professional portals:

```text
Conversation channels
    |
Conversation Engine
    |
Workflow Orchestrator
    |
Versioned API layer
    |
Domain engines
    |
Tenant-scoped database
```

The WhatsApp adapter is limited to webhook verification, payload normalization,
media transfer, outbound message delivery, and provider-specific error mapping.
Business logic must not live in the adapter.

The RC1 canonical workflow library is:

- WF-001 — Patient Registration
- WF-002 — Authentication
- WF-003 — Prescription Upload
- WF-004 — Prescription Parsing
- WF-005 — Medicine Search
- WF-006 — Medication Access Request
- WF-007 — Clinical Review
- WF-008 — Inventory Discovery
- WF-009 — Reservation
- WF-010 — Pickup
- WF-011 — Delivery
- WF-012 — Medication Reminder
- WF-013 — Consultation
- WF-014 — Refill
- WF-015 — Workflow Completion

Accepted workflow actions emit versioned domain events through a transactional
outbox. Consumers use events for notifications, analytics, audit projections,
and recovery; they remain idempotent and may not bypass domain commands.

## RC1 backlog

The repository predates the Conversation-Driven Architecture strategy. RC1 is
therefore not feature-complete until the following implementation and
certification work is finished:

- Implement the Conversation Engine and its persistence model.
- Implement the Workflow Orchestrator and canonical workflow contracts.
- Implement the transactional event outbox, event contracts, and idempotent
  consumers.
- Implement the WhatsApp provider adapter and verified webhook boundary.
- Deliver the complete conversational patient journey defined in Wave 3.
- Reconcile existing patient web flows with the professional-portal boundary.
- Add idempotency, replay protection, ordering, retry, and dead-letter handling
  for inbound and outbound messages.
- Add consent, opt-out, retention, redaction, media-expiry, and account-linking
  controls for WhatsApp identities and content.
- Test human handoff, interrupted sessions, duplicate messages, provider outage,
  and delayed or out-of-order delivery.
- Execute all migrations against the target PostgreSQL/Supabase environment.
- Run API integration tests against that environment.
- Select and configure the production OCR provider.
- Complete runtime tests for WhatsApp, payment, notification, and other provider
  adapters.
- Validate FHIR, HL7, and HMO adapters in partner conformance environments.
- Conduct load, penetration, backup, restore, and disaster-recovery exercises.
- Record evidence, owners, dates, results, and remediation for every exercise.

These items close existing certification requirements. They do not authorize
new product features.

## RC2 roadmap proposal

This proposal groups post-RC1 capabilities for later planning only. It does not
authorize implementation.

### Candidate A — Additional channel expansion

- SMS workflows
- USSD access for low-connectivity users
- Native mobile application
- Channel-specific consent, localization, delivery receipts, and escalation

Entry criteria: the RC1 Conversation Engine, Workflow Orchestrator, and WhatsApp
adapter are production-certified, and channel privacy, retention, and
failure-mode requirements are approved.

### Candidate B — Payer and care-network integration

- Production HMO integrations
- Expanded hospital and e-prescription connectivity
- Eligibility, authorization, claims, and reconciliation workflows
- Partner onboarding and conformance automation

Entry criteria: signed partner contracts, approved data-processing terms,
versioned conformance profiles, and operational support ownership.

### Candidate C — Assisted intelligence expansion

- Improved prescription extraction and confidence calibration
- Additional pharmacist-facing clinical assistance
- Medication education enhancements
- Governed model evaluation, monitoring, and human-review tooling

Entry criteria: approved clinical evaluation datasets, safety thresholds,
model-risk controls, rollback procedures, and accountable clinical owners.
No AI capability may independently make a clinical decision, approve a
substitution, change dosage, or transition an MAR.

### Candidate D — Nationwide operations

- Nationwide pharmacy-network onboarding
- Home-delivery integration
- National availability and stockout dashboards
- Regional capacity, observability, and support expansion

Entry criteria: RC1 reliability objectives are met, delivery and pharmacy
partners are contracted, and national regulatory and operational readiness is
documented.

### Candidate E — Multi-country platform

- Country-specific medicine catalogs and regulatory adapters
- Localization, currencies, payment providers, and residency controls
- Cross-border supply integrations where legally permitted
- Country-isolated operations, reporting, and incident response

Entry criteria: country-by-country legal and regulatory approval, data-residency
design, local clinical governance, and a validated tenant-isolation model.

## Planning guardrails

- Candidate groups are not numbered continuation waves.
- A candidate becomes implementation scope only through an approved RC2 plan.
- Each candidate requires measurable acceptance criteria, named owners,
  dependencies, risk review, and certification evidence before scheduling.
- RC1 architecture and safety invariants remain binding in all later releases.
- Feature flags must not be used to conceal incomplete RC1 certification.
