# ADR 0006: Wave Transition Framework

- Status: Accepted
- Date: 2026-07-30

## Context

RC1 engineering and automated certification are complete, but GA depends on
external operational evidence. Future waves need preparation without adding
unauthorized Wave 2.5 business capabilities or modifying certified foundations.

## Decision

Introduce a governance-only Wave Transition Framework:

- Governance owns the wave registry and roadmap initiative lifecycle.
- Platform owns the capability registry and dependency traceability.
- Integrations owns certified provider-neutral extension registration.
- API owns audience-specific semantic-version compatibility contracts.
- Certification owns the aggregate wave-transition admission decision.

The framework may become ready independently, but wave admission additionally
requires RC1 operational certification and explicit executive wave approval.
No framework object implements a healthcare business capability.

## Consequences

- Wave 2.5 remains blocked until all admission evidence is valid.
- Extension and SDK evolution use stable, versioned contracts.
- Roadmap work cannot reach rollout without architecture, approval, and
  certification evidence.
- Certified core components remain unchanged by future provider selection.
