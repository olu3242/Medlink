# ADR 0009: Minimal Agent Runtime Contract

- Status: Accepted
- Date: 2026-07-30

## Context

Prescription scanning, OCR, parsing, and clinical-warning assistance need one
consistent policy, telemetry, context, and human-review boundary. A full
Agentic Operating System would violate the MVP Constitution by adding planning,
autonomous orchestration, consensus, generalized memory, and speculative
platform services.

## Decision

Adopt `@medlink/agent-runtime` as a deterministic contract library containing:

- Task and bounded healthcare context contracts
- One MVP policy evaluator
- Task telemetry observer
- One standardized pharmacist-approval result
- One bounded stage lifecycle (`initialize`, `validate`, `execute`, `verify`,
  `publish`, `complete`)
- A small executor with no scheduler, planner, memory, delegation, or autonomy

The runtime permits file scanning, OCR, parsing, and warning generation.
Substitution, clinical recommendations, clarification resolution, and
prescription approval return `pending_human_review`. Unknown and cross-tenant
actions fail closed.

OCR and prescription parsing use the stage lifecycle through `ML-ARC-006`.
Provider output is verified before the existing workflow/transaction runtime
persists domain state, immutable evidence, and outbox events. Deterministic
confidence validation is a domain operation, not an AI task. Pharmacist
decisions are executed only by the authenticated clinical command and never by
ARC.

## Consequences

MVP AI/provider adapters share stable execution and evidence semantics without
creating a new platform or bypassing existing Runtime, Workflow, Audit,
Observability, Identity, or Certification ownership. Post-pilot evolution
requires a new ADR and cannot weaken human clinical authority.
