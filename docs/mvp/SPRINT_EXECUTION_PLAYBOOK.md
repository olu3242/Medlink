# MedLink MVP Sprint Execution Playbook

## Sprint contract

Every sprint records:

- Goal and North Star impact
- Approved capability slice
- User story and acceptance criteria
- Dependencies and owners
- Clinical, security, data, and operational risks
- Demonstration and evidence plan

Every sprint ends with working deployable software, full regression, updated
matrix/backlog, and a demonstrated canonical workflow.

## Roadmap

1. Platform/identity completion
2. Patient, pharmacy, pharmacist and medicine master data
3. Prescription intake, storage, scanning and AI parsing
4. Pharmacist clinical review and clarification
5. Inventory, catalogue discovery and alternatives
6. Reservation, confirmation, notification and fulfillment
7. Administration, audit, monitoring and support
8. End-to-end pilot readiness, security, performance and UAT

Sequence may change only when dependencies or pilot learning justify it; scope
may not expand without constitutional change control.

## Sprint close

Run lint, TypeScript, unit/integration/workflow/security tests, relevant builds,
migration/RLS validation, and UI accessibility review. Record defects and never
mark a capability complete with an open mandatory column.
