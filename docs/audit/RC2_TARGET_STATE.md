# RC2 Target State

Authority: MVP Constitution, ADR-0003, ADR-0008, ADR-0009, and the Enterprise
Runtime Contract.

## Product outcome

A patient in the pilot LGA can authenticate, submit a prescription, receive
bounded extraction, obtain a licensed-pharmacist decision, discover approved
medicine in participating stock, reserve it atomically, receive confirmation,
collect it, and inspect a secure history. WhatsApp is the primary patient
channel; web is a fallback over the same APIs and workflows.

```text
Patient -> Prescription -> ARC scan/OCR/parse -> Pharmacist review
        -> Catalogue resolution -> FEFO inventory discovery
        -> Reservation/lock -> Pharmacy confirmation -> Pickup
        -> Notification -> Audit/telemetry/history
```

## Required architecture

- All protected entry points authenticate, resolve active membership and
  tenant, authorize through shared permissions, validate typed input, and call
  an application use case.
- Domain state, audit evidence, idempotency, and versioned outbox events commit
  atomically through database commands.
- PostgreSQL RLS is the final tenant boundary and is proven with authenticated
  allow/deny tests, not source inspection alone.
- ARC may scan, extract, parse, and produce advisory flags. It has no planner,
  generalized memory, delegation, autonomous state transition, or clinical
  authority.
- A verified licensed pharmacist is the only authority for clinical decisions
  and alternatives.
- Conversation adapters contain transport logic only. They invoke the same
  versioned APIs/workflows as the fallback web experience.

## Capability exit target

Each of `ML-CAP-001` through `ML-CAP-012` must have applicable business/domain,
database/RLS, API, UI/conversation, workflow, event, audit, telemetry, recovery,
test, documentation, and deployment evidence. A source-only or mocked provider
path remains `PARTIAL` or `BLOCKED`.

## Certification target

1. Clean dependency install, lint, strict TypeScript, full tests and coverage.
2. All eight applications build reproducibly.
3. All migrations apply cleanly to an isolated RC2 Supabase project.
4. Authenticated tenant A/tenant B tests prove reads, writes, commands, worker
   access, and service-role boundaries.
5. Scanner, OCR/parser, and WhatsApp provider conformance pass with retries,
   duplicates, timeouts, and recovery.
6. The Golden Path executes through WhatsApp and fallback web without direct
   database mutations in routes or clients.
7. Every accepted transition produces immutable audit, event, correlation,
   telemetry, and actionable failure evidence.

## Explicit non-targets

No target-state requirement authorizes new personas, MAOS/MAIF, autonomous AI,
FHIR/OpenHIE, hospital/EMR integration, insurance, marketplace, payment-led
checkout, delivery fleet, population health, national analytics, configurable
workspaces, or Engines 36-40.
