# MedLink MVP Definition of Ready and Done

## Definition of Ready

A capability is ready when:

- It is in MVP scope and tied to the North Star.
- User, objective, workflow, acceptance criteria, and owner are clear.
- Dependencies and external provider decisions are available.
- Domain ownership and existing reusable components are identified.
- Data classification, RLS, threat, clinical-safety, audit, and recovery
  requirements are reviewed.
- API/event compatibility and UI flow are designed.
- Test and demonstration plans are agreed.
- No unresolved blocker makes complete vertical delivery impossible.

## Definition of Done

A capability is done only when:

- Business invariants and failure modes are implemented.
- Migration, constraints, RLS, rollback/forward recovery and repositories pass.
- API and event contracts are authenticated, authorized, validated, versioned,
  idempotent where required, audited and observable.
- Persona UI is usable, responsive and accessibility-reviewed.
- AI output is governed and human-reviewed where applicable.
- Notifications are consented, idempotent and traceable where applicable.
- Unit, integration, contract, RLS, security, workflow and E2E acceptance pass.
- Full baseline regression and relevant production builds pass.
- Documentation, runbooks, matrix and evidence are current.
- The workflow is demonstrated without engineering intervention.

No waiver can make a partially implemented clinical or security boundary
complete.
