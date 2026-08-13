# ADR 0008: RC2 MVP Scope Lock

- Status: Accepted
- Date: 2026-07-30

## Context

RC2 was initially authorized as an isolated innovation branch with a proposed
Engines 36–40 roadmap. The subsequent MedLink MVP v1.0 master directive narrows
the active product objective to successful pharmacist-supervised prescription
fulfillment in one Lagos LGA.

Implementing national interoperability, population health, national analytics,
autonomous operations, insurance, or other ecosystem capabilities before the
pilot would dilute the North Star metric and introduce unnecessary delivery and
clinical risk.

## Decision

`rc2-development` is the active MVP delivery branch. It implements only the
twelve approved prescription-fulfillment capabilities through seven MVP
engines:

1. Identity and Access
2. Prescription Management
3. Clinical Review
4. Pharmacy Inventory
5. WhatsApp-first Communication
6. Administration
7. AI Assistance with mandatory human review

FHIR, OpenHIE, EMR/hospital integration, insurance, population health,
marketplace, supply-chain optimization, delivery fleet, predictive/national
analytics, autonomous AI, and Engines 36–40 are moved to the post-MVP roadmap.
They are not authorized for implementation on the MVP branch.

## Safety boundaries

- AI never approves, rejects, substitutes, doses, or transitions clinical state.
- A licensed pharmacist approves every recommendation.
- Every capability is a complete tenant-safe, authenticated, authorized,
  validated, audited, observable, tested vertical slice.
- Architecture may expose stable extension points but may not implement
  speculative behavior.
- The North Star metric is Successful Prescription Fulfillment Rate.

## Consequences

Existing RC1 platform/governance packages remain available but do not justify
new MVP scope. Capability status is tracked in
`docs/mvp/MVP_CAPABILITY_MATRIX.md`; incomplete columns remain explicit.
