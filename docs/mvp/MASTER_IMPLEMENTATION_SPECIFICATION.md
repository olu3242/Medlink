# MedLink MVP Master Implementation Specification

## Product target

Production-quality prescription fulfillment for one Lagos LGA, optimized for
Successful Prescription Fulfillment Rate.

## Approved capabilities

1. Identity and Access
2. Patient Management
3. Pharmacy Management
4. Pharmacist Management
5. Medicine Catalogue
6. Prescription Intake
7. Clinical Review
8. Inventory
9. Medicine Search
10. Reservation
11. WhatsApp-first Communication
12. Administration

These capabilities are implemented through Identity, Prescription, Clinical
Review, Pharmacy Inventory, Communication, Administration, and AI Assistance
engines. Engine names do not create additional scope.

## Required API conventions

- REST under `/api/v1`
- Authenticated membership-backed tenant context
- RBAC before use-case execution
- Zod validation and safe problem responses
- Idempotency for mutation/retry boundaries
- Runtime audit, event, correlation, metrics, tracing, and recovery evidence

## Data constraints

Create only patient, pharmacist, pharmacy, catalogue, prescription,
prescription-item, inventory, reservation, notification, attachment, audit,
organization, and tenant data required by the pilot. Every tenant record
requires RLS and automated allow/deny evidence.

## AI output contract

Every result carries confidence, extracted medicines, suggested catalogue
alternatives, clinical warnings, explanation, model/prompt provenance, and
human-review status. Patient channels receive only pharmacist-approved clinical
content.

## UI target

Deliver complete responsive journeys for patient, pharmacist, pharmacy, and
administrator. WhatsApp is the primary patient channel; web supports the same
canonical APIs without duplicating rules.

## Quality target

Each capability passes unit, integration, contract, tenant/RLS, workflow,
security, accessibility, build, TypeScript, lint, and appropriate performance
and recovery validation.
