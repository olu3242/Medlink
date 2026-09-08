# Persona Object Access Matrix

Executable authority: `packages/platform/src/persona-contracts.ts`, composed with
`packages/platform/src/authorization.ts`, authenticated tenant resolution in
`packages/api/src/index.ts`, and PostgreSQL RLS. UI visibility is not an
authorization boundary.

## Active MVP personas

| Persona | Object | Read | Create | Update | Delete | Special actions | Scope | Sensitive fields |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Patient | Medicine / public pharmacy | Yes | No | No | No | Search, compare | Network public projection | Canonical/internal IDs and provenance hidden |
| Patient | Prescription / MAR | Own | Own | Workflow only | No | Submit | Own records | Other-patient and internal clinical fields hidden |
| Patient | Reservation | Own | Own | No | No | Credential issuance; cancellation not yet implemented | Own records | Batch, supplier, reserved quantity, internal history hidden |
| Patient | Payment | Own | Own | No | No | Initiate | Own records | Ledger and settlement internals hidden |
| Pharmacist | Prescription / clinical review | Assigned | No | Decision only | No | Recommend, approve pending review, fulfill | Assigned organization | Relevant clinical context only |
| Pharmacist | Inventory | Yes | No | No | No | Availability review | Assigned organization | Supplier, cost, margin, and adjustment history absent |
| Pharmacist | Settlement / platform policy | No | No | No | No | None | None | Entire object denied |
| Pharmacy Staff | Inventory | Yes | Yes | Yes | No | Receive and adjust stock | Organization | Supplier and commercial cost/margin hidden |
| Pharmacy Staff | Reservation | Yes | No | Workflow only | No | Confirm, ready, collect | Organization | Patient credential plaintext never exposed |
| Pharmacy Staff | Clinical review | No | No | No | No | None | None | Entire protected action denied |
| Pharmacy Manager (`pharmacy_owner`) | Inventory | Yes | Yes | Yes | No | Operational management | Organization | Supplier and configured sell price available; no network scope |
| Pharmacy Manager | Membership | Yes | Yes | Yes | No | Manage pharmacy staff | Organization | Other organizations denied by tenant/RLS scope |
| Pharmacy Manager | Platform policy | No | No | No | No | None | None | Entire object denied |
| MedLink Admin | Organization / catalogue | Yes | Yes | Yes | Governed | Govern | Network, subject to permission | Canonical IDs, provenance, mapping and audit metadata permitted |
| MedLink Admin | Clinical review | No | No | No | No | No clinical approval | None | Admin authority does not imply licensed clinical authority |
| AI Agent / System Actor | Minimized task context | Policy-bound | No direct domain create | No direct domain update | No | Read, recommend, classify, route | Inherited caller tenant/task | Direct persistence and final clinical decisions denied |

`inventory_manager` maps to the Pharmacy Staff contract. `tenant_admin` maps to
the Admin portal but its navigation remains capability-filtered by its actual
role maximum.

## Deferred personas

| Persona | Status | Access decision |
| --- | --- | --- |
| Provider | Role remains for compatibility; portal not active | Fail closed (`personaContractForRole("provider")` returns `null`) pending constitutional admission |
| Finance Ops | Not admitted to MVP taxonomy | No role, portal, route, or object authority |
| Support Ops | Operational support services exist, but no human persona is admitted | No interactive role or protected mutation authority |

## Enforcement chain

1. Supabase verifies the identity.
2. The active organization membership resolves exactly one tenant and role.
3. `authorize` enforces the registered coarse permission.
4. Persona contracts narrow portal, route, object, field, and workflow access.
5. API applications query using the trusted organization context.
6. RLS is the final row-isolation authority.
7. Runtime evidence records authorized protected operations.

The contract is deny-by-default for unknown roles, objects, fields, actions,
workflow states, and deferred personas. Inventory API projections remove fields
from serialized responses; they are not merely hidden in the DOM.
