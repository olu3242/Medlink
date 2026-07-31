# ADR 0005: Enterprise Service Management Platform

- Status: Accepted
- Date: 2026-07-30

## Context

After deployment and stabilization, MedLink needs a permanent operating model
for service ownership, customer success, administration, intelligence, and
continuous improvement. This layer must not duplicate runtime, identity,
observability, incident, continuity, or certification ownership.

## Decision

- Runtime owns the service catalog and health evaluation.
- Analytics owns tenant-scoped customer health and operational scorecards.
- Platform owns audited administration and tenant-aware dashboard projection.
- Governance owns improvement classification and its mandatory lifecycle.
- AI operations assistance remains evidence-backed and advisory.
- Certification aggregates the ESMP evidence and fails closed.

Administrative ports emit audit events into the existing governance ledger.
Dashboards expose only evidence-bearing metrics allowed by tenant scope and role.
Improvement candidates cannot skip approval or certification, and Wave 2.5
candidates are never executable merely because they were classified.

## Consequences

The platform gains a durable operating model without a second runtime or workflow
engine. Synthetic tests validate control behavior but do not create GA evidence.
