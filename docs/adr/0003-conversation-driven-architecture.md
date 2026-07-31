# ADR 0003: Conversation-Driven Architecture

## Status

Accepted.

## Context

MedLink's primary RC1 patient experience is WhatsApp, while pharmacists,
pharmacies, hospitals, and administrators use richer professional portals.
Defining the architecture around WhatsApp itself would couple the platform to a
single provider and channel. Future channels must be able to reuse the same
patient journeys without moving or duplicating business rules.

MedLink therefore needs explicit boundaries between user dialogue, long-running
business processes, domain truth, and channel transport.

## Decision

MedLink adopts Conversation-Driven Architecture (CDA). Conversations are the
primary patient interface. WhatsApp is the first RC1 conversation channel, not
the architecture.

```text
Conversation channels
    |
Conversation Engine
    |
Workflow Orchestrator
    |
Versioned Experience API
    |
Domain engines and platform services
    |
System of Record
```

### System of Engagement

The System of Engagement contains replaceable user channels and professional
interfaces. RC1 includes WhatsApp and professional web portals. SMS, USSD,
voice, native mobile, and autonomous agent channels remain future candidates.

Channel adapters handle transport concerns only: provider authentication,
webhook verification, payload normalization, media transfer, delivery, and
provider-specific error mapping.

### Conversation Engine

The Conversation Engine is a first-class platform engine responsible for:

- Conversation lifecycle, sessions, and bounded context memory
- Intent and identity resolution
- Dialogue routing and human handoff
- Message ordering, delivery receipts, retries, and timeouts
- Interruption recovery
- Idempotency, correlation identifiers, and audit records

It does not own medication, clinical, inventory, reservation, pricing, payment,
or fulfillment rules.

### Workflow Orchestrator

The Workflow Orchestrator coordinates durable business processes. Conversations
invoke workflows; workflows invoke versioned domain APIs. The orchestrator owns
process position, waits, compensation, retry policy, and completion state, but
domain engines remain authoritative for their own transitions and invariants.

The canonical RC1 workflow library is:

| ID | Workflow |
| --- | --- |
| WF-001 | Patient Registration |
| WF-002 | Authentication |
| WF-003 | Prescription Upload |
| WF-004 | Prescription Parsing |
| WF-005 | Medicine Search |
| WF-006 | Medication Access Request |
| WF-007 | Clinical Review |
| WF-008 | Inventory Discovery |
| WF-009 | Reservation |
| WF-010 | Pickup |
| WF-011 | Delivery |
| WF-012 | Medication Reminder |
| WF-013 | Consultation |
| WF-014 | Refill |
| WF-015 | Workflow Completion |

Workflow contracts are channel-neutral and versioned. A channel may expose only
the workflows appropriate to its capabilities, but it may not redefine them.

### System of Record

Business truth is stored only in the System of Record. It includes patients,
medicines, pharmacies, inventory, Medication Access Requests, prescriptions,
consultations, reservations, payments, and audit history. Conversation state
may reference this truth but must not become a competing source of truth.

Domain engines never depend on a messaging channel. All channels and
professional portals use the same versioned APIs and authorization policies.

### AI boundary

AI is a shared, governed capability behind an AI Coordinator. OCR, medicine
matching, clinical assistance, inventory finding, and education assistance are
invoked through typed contracts by workflows or authorized professional tools.
AI logic does not live in channel adapters.

AI output is advisory. It cannot approve a clinical decision, finalize a
substitution, change dosage, transition an MAR, or bypass required human review.

### Event backbone

Every significant accepted action emits a versioned domain event through a
transactional outbox. Initial event names include:

- `conversation.started`
- `conversation.resumed`
- `prescription.uploaded`
- `prescription.parsed`
- `mar.created`
- `mar.review.requested`
- `inventory.match.completed`
- `reservation.created`
- `reservation.expired`
- `consultation.assigned`
- `pickup.confirmed`
- `workflow.completed`

Events drive notifications, analytics, audit projections, and asynchronous
recovery. Event consumers must be idempotent. Events do not permit consumers to
bypass domain commands, authorization, or clinical controls.

## Invariants

- Conversations are the primary patient interface.
- Domain engines never depend on a conversation channel.
- All channels use the same versioned APIs.
- Conversations invoke workflows; workflows invoke domain engines.
- Business state exists only in the System of Record.
- Channels are replaceable without changing business logic.
- Every accepted conversation step is auditable, idempotent, correlated, and
  replay-safe.
- Tenant, consent, retention, and least-privilege policies apply at every layer.

## Consequences

Wave 3 delivers the Conversation Engine, Workflow Orchestrator, WhatsApp
adapter, canonical MVP workflows, and required domain integrations.
Professional portals remain Wave 4 operational interfaces.

The additional engine and orchestration boundary increase RC1 implementation
and testing work. In return, future channels can reuse workflows and domain
contracts without an architectural redesign.

ADR 0002 is superseded because it described the correct RC1 channel priority
but named the architecture after its first transport.
