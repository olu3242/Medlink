# MedLink MVP Master Execution Blueprint

## Mission

Turn the MVP specification into deployable software through complete,
capability-based vertical slices. Optimize for working business capability, not
code volume.

## Session protocol

Every implementation session:

1. Read `MVP_CONSTITUTION.md`.
2. Review `MVP_CAPABILITY_MATRIX.md` and the active sprint.
3. Select one approved, ready capability.
4. Analyze business goal, users, workflow, dependencies, risks, and North Star
   impact.
5. Design domain, data, API, UI, validation, security, audit, observability,
   AI/notification boundaries, and tests.
6. Build in dependency order.
7. Run focused and full regression gates.
8. Demonstrate the affected workflow.
9. Update evidence, matrix, backlog, and documentation.
10. Stop at a clean deployable checkpoint.

## Implementation order

```text
Requirement
  -> Domain
  -> Database/RLS
  -> Application service
  -> REST API
  -> UI
  -> AI integration (when applicable)
  -> Notifications (when applicable)
  -> Tests
  -> Documentation
  -> Deployment validation
```

Database-only, API-only, UI-only, and untested delivery are prohibited.

## Capability lifecycle

`Proposed -> Approved -> Designed -> Implemented -> Tested -> Certified -> Pilot Ready`

Each transition requires evidence. A capability may move backward when a defect,
missing dependency, or invalidated assumption is discovered.

## Virtual specialist accountabilities

These identifiers describe review responsibilities; they do not grant
autonomous authority.

| Identifier | Accountability |
| --- | --- |
| `ML-ARCH-001` | Scope, architecture, ownership, ADRs |
| `ML-DOM-001` | Business invariants and domain services |
| `ML-DATA-001` | Schema, migrations, RLS, integrity, recovery |
| `ML-API-001` | Application services, REST contracts, errors |
| `ML-AI-001` | OCR/AI ports, evaluation, confidence, human review |
| `ML-UX-001` | Accessible persona workflows and responsive UI |
| `ML-QA-001` | Unit, integration, workflow, E2E, regression evidence |
| `ML-SEC-001` | Threats, authentication, authorization, secrets, abuse controls |
| `ML-DOC-001` | Specifications, decisions, runbooks, user guidance |
| `ML-REL-001` | CI, build, migration, deployment and rollback readiness |

No specialist can waive the Constitution or clinical human-approval boundary.

## Continuous validation

Validate the end-to-end workflow after every capability. For Prescription
Intake, completion means upload, private storage, scanning, OCR/AI extraction,
audit, and pharmacist queue population all work—not merely that an endpoint
exists.

## Guardrails

Reject out-of-scope features, duplicated ownership, speculative abstractions,
unsafe shortcuts, fake provider evidence, unaudited behavior, and completion
claims without executable evidence. Record useful deferred ideas in the
Post-MVP backlog.
