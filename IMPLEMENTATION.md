# MedLink RC1 Enterprise Implementation Contract

This document is the governing Product Execution Blueprint, Domain
Implementation Blueprint, and Engineering Governance Framework for MedLink RC1.
It remains authoritative until RC1 is certified.

All executable components must also conform to
`docs/ENTERPRISE_RUNTIME_CONTRACT.md`. This document governs what is built; the
runtime contract governs how every operation executes.

All changes must also follow `docs/PLATFORM_EVOLUTION_FRAMEWORK.md`, which
governs classification, compatibility, evolution, release promotion, and
certification maturity.

## Mission

Deliver MedLink RC1 as a production-ready, enterprise-certified,
Conversation-Driven Medication Access Platform. WhatsApp is the primary patient
channel. Pharmacists, pharmacies, hospitals, and administrators use secure
professional web portals.

MedLink is not a pharmacy, e-commerce application, EMR, or medicine
marketplace. It connects patients and professional stakeholders through
governed medication-access workflows.

## RC1 scope contract

Implementation is strictly limited to Waves 1–5. Never invent Waves 6–10 or
implement RC2 functionality.

Before implementation:

1. Read `docs/release-scope.md`.
2. Confirm the request belongs to the active RC1 wave.
3. If it does not, stop and classify it as RC1 Backlog or RC2 Roadmap.
4. Continue only when it is approved RC1 scope.

Completed waves are frozen. Modify them only under an approved ADR or for a
critical correctness, security, safety, or certification fix.

### Wave Isolation Rule

A wave may depend on certified artifacts from previous waves but must not
implement responsibilities owned by future waves. If delivering a capability
would require functionality assigned to a later wave, implement only the
contracts, interfaces, ports, or extension points necessary for future
integration. The implementation itself remains in its owning wave.

Examples:

- Wave 2 may define channel-neutral medicine and clinical APIs, but it must not
  implement conversations, WhatsApp handlers, MAR workflows, inventory,
  reservations, or portals.
- Wave 3 may consume Wave 2 clinical contracts and implement patient
  conversations, but it must not implement professional portals.
- Wave 4 may consume certified Wave 2 and Wave 3 APIs and workflows, but it must
  not duplicate their business logic in portal applications.

Future-wave extension points must remain inert, tested contracts. They are not
feature flags for incomplete implementations.

### Platform Freeze Gate

After Track A certification, the runtime platform enters a managed, frozen
state. This includes `packages/runtime`, shared middleware, transaction and Unit
of Work components, authentication, tenant resolution, authorization, audit,
outbox, idempotency, recovery, and observability.

Changes to the frozen platform are limited to:

- Security fixes
- Production reliability fixes
- Performance improvements
- Regulatory compliance updates
- Approved Architecture Decision Records

Waves 2–5 consume these shared services. Business feature work must not modify,
fork, or bypass the runtime platform.

## Core model

The conversation is the patient experience. The Medication Access Request (MAR)
is the core business object.

```text
Conversation
    |
Workflow
    |
Medication Access Request
    |
Domain engines
    |
Platform services
    |
System of Record
```

The canonical business objects are Patient, Organization, Pharmacy, Hospital,
Medicine, Active Ingredient, Prescription, Medication Access Request,
Inventory, Reservation, Consultation, Conversation, Workflow, Notification,
Payment, and Audit Event. Do not create competing models.

## Architecture

Apply Domain-Driven Design, Clean Architecture, Event-Driven Architecture,
API-First Design, Conversation-Driven Architecture, multi-tenant SaaS controls,
AI-assisted clinical decision support, and applicable healthcare standards.

```text
Conversation channels
    |
Conversation Engine
    |
Workflow Orchestrator
    |
Experience API
    |
Domain engines
    |
Platform services
    |
Infrastructure and System of Record
```

RC1 includes WhatsApp. SMS, USSD, voice, native mobile, and other conversation
channels are future scope. Channels are replaceable and business logic must
never depend on a channel.

The System of Engagement contains conversation channels and professional
portals. The System of Record alone stores business truth for patients,
medicines, prescriptions, MARs, inventory, reservations, consultations,
payments, notifications, and audit history.

Never place business logic in React components, WhatsApp handlers, mobile
clients, API routes, infrastructure adapters, or AI prompts. Business rules
belong in domain and application layers.

## RC1 wave plan

RC1 execution uses two tracks:

1. **Track A — Platform Convergence:** S01.6–S01.10. No feature work. Track A
   exits only when the Enterprise Runtime Contract and its certification gates
   pass.
2. **Track B — Business Capability Delivery:** Waves 2–5. Track B cannot begin
   until Track A is certified.

### Wave 1 — Platform Foundation

Status: complete and frozen.

Identity, RBAC, tenant resolution, shared services, observability, database, and
CI/CD.

### Wave 2 — Clinical Intelligence

- Batch 2.1 — Medicine Knowledge
- Batch 2.2 — Medication Equivalency
- Batch 2.3 — Prescription Intelligence
- Batch 2.4 — Clinical Intelligence
- Batch 2.5 — Search Platform and Wave Certification

Wave 2 is limited to medicine catalogs, ingredients, ATC classification,
manufacturers, dosage forms, routes, strengths, interactions,
contraindications, storage guidance, equivalency, prescription extraction,
clinical rules, search, versioned APIs, events, tests, and certification.

Wave 2 excludes MAR, conversations, WhatsApp, inventory, reservations, and
professional portals.

### Wave 3 — Conversation Platform (Primary MVP)

- Batch 3.1 — Conversation Engine
- Batch 3.2 — Workflow Orchestrator
- Batch 3.3 — Medication Access Request
- Batch 3.4 — Inventory Discovery
- Batch 3.5 — Reservation and Fulfillment

Wave 3 includes the WhatsApp adapter, patient conversations, conversation APIs,
runtime recovery, idempotency, replay, ordering, and session memory. It excludes
professional portals.

### Wave 4 — Professional Operations

- Batch 4.1 — Pharmacy Portal
- Batch 4.2 — Pharmacist Portal
- Batch 4.3 — Hospital Portal
- Batch 4.4 — Administrator Portal

Portal dashboards, queues, analytics, and management interfaces consume
certified APIs and workflows without implementing domain business logic.

### Wave 5 — Enterprise Platform

Analytics, governance, integrations, certification, and operational tooling.

## Canonical workflow library

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

Each workflow defines states, legal transitions, timeouts, recovery,
compensation, escalation, authorization, audit, and versioned events. Channels
invoke the same workflow contracts.

Every conversation defines intent, context, state, bounded memory, timeout,
recovery, escalation, and audit behavior.

## Canonical state machines

MAR:

```text
Draft -> Submitted -> Validated -> Review -> Searching -> Matched
      -> Reserved -> Paid -> Dispensed -> Completed -> Archived
```

Reservation:

```text
Created -> Confirmed -> Fulfilled
       \-> Expired
       \-> Cancelled
```

Conversation:

```text
Started -> Active -> Waiting -> Escalated -> Resolved -> Closed
```

Transitions occur only through domain policies. No workflow, channel, API, AI
agent, or event consumer may bypass a state machine.

## Domain events

Every accepted business transition emits a versioned event through a
transactional outbox. Initial events include:

- `patient.created`
- `conversation.started`
- `conversation.resumed`
- `prescription.uploaded`
- `prescription.parsed`
- `mar.created`
- `review.assigned`
- `review.completed`
- `inventory.updated`
- `inventory.matched`
- `reservation.created`
- `reservation.expired`
- `payment.completed`
- `pickup.confirmed`
- `workflow.completed`

Never mutate business state silently. Event consumers are tenant-aware,
idempotent, observable, and replay-safe. Events do not bypass domain commands.

## AI agent catalog and safety

The governed agent catalog contains Conversation, OCR, Medicine Match,
Inventory, Clinical Review Assistant, Reservation Coordinator, Medication
Education, and Analytics agents.

Every agent documents its mission, typed inputs and outputs, memory boundary,
confidence, policies, escalation, and least-privilege tools. AI is a shared
capability, not a channel feature. It supports licensed professionals and never
replaces clinical judgment, approves a substitution, changes dosage, or
transitions an MAR.

## Engine implementation blueprint

Every engine uses explicit boundaries:

```text
Engine
|-- Domain
|-- Application
|-- Infrastructure
|-- API
|-- Events
|-- Workflows
|-- AI
|-- Security
|-- Tests
|-- Documentation
`-- Certification
```

- **Domain:** entities, aggregates, value objects, policies, state machines, and
  business rules; no infrastructure.
- **Application:** commands, queries, handlers, services, and use cases; no SQL.
- **Infrastructure:** Supabase, repositories, OCR, storage, queues, search, and
  cache; no business rules.
- **API:** validation, authentication, tenant resolution, authorization, use
  case execution, events, audit, telemetry, and response mapping.
- **Workflow:** states, transitions, timeouts, recovery, compensation, and
  escalation.
- **Security:** roles, permissions, tenant, audit, privacy, consent, retention,
  and least-privilege rules.
- **Tests:** unit, integration, contract, workflow, performance, RLS, and
  certification tests.
- **Documentation:** README, API contracts, architecture, sequence diagrams,
  changelog, and ADR references.

All engines reuse authentication, RBAC, tenant context, audit, telemetry,
notifications, queue, storage, search, feature flags, and configuration. Do not
reimplement shared platform services.

## Definition of done and certification

A feature is complete only when it includes applicable database changes, domain
logic, application services, APIs, validation, RBAC, RLS, audit, events,
observability, tests, documentation, and certification evidence.

Every engine must pass build, TypeScript, tests, coverage threshold, RLS,
observability, and performance gates before merge. Environmental or partner
certification gaps produce a conditional pass, never an unsupported pass.

Every pull request must identify:

- Engine and workflow changes
- Events and APIs added or changed
- ADR and documentation changes
- Tests and certification evidence
- Tenant-isolation impact
- Remaining risks and dependencies

Implement only the assigned batch, preserve architecture, reuse shared services,
avoid unrelated regeneration, and leave every batch independently compilable.

## Required implementation report

Every implementation finishes with:

```text
Status
PASS | CONDITIONAL PASS | FAIL

Files Changed
Database Changes
Migration
APIs Added
Events Added
Tests Added
Documentation Updated
Certification Status
Known Risks
Blocked By
Next Dependency
Recommended Next Batch
```

## RC1 success criterion

RC1 succeeds when a patient can start a WhatsApp conversation, authenticate,
upload a prescription, receive OCR-assisted identification, complete required
pharmacist review, locate a nearby pharmacy, reserve medicine, confirm pickup,
receive a medication reminder, and close the workflow without visiting a
website.

Professional portals support pharmacists, pharmacies, hospitals, and
administrators through the same APIs, workflows, domain engines, security
policies, and System of Record.
