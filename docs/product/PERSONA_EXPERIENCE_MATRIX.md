# Persona Experience Matrix

Executable authority: `packages/platform/src/persona-contracts.ts`. Unified
portal layouts derive navigation and semantic visual identity from that file.

| Persona | Portal | Primary job | Dashboard | Navigation | Theme | Density | Primary CTA | Objects | Restricted objects | Critical workflows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Patient | `/patient` | Find and obtain prescribed medicine | Active requests and clear next step | Home, Find Medicine, Reservations, Prescriptions, Profile | Calm MedLink teal with care green | Low; mobile-first | Find Medicine | Own prescription, MAR, reservation, payment; public medicine/pharmacy | Internal inventory, clinical approval, settlement, audit, governance | Search → review → match → reserve → collect |
| Pharmacist | `/pharmacist` | Make licensed clinical decisions | Clinical queue, safety and stock alerts | Workspace, Clinical Queue | Clinical blue/deep teal; amber/red safety states | High; exception-first | Review next | Assigned clinical review, medicine intelligence, scoped inventory | Other organizations, settlement, platform policy | Pending review → licensed decision → fulfillment handoff |
| Pharmacy Staff | `/pharmacy` | Operate stock and fulfillment | Inventory and reservation queues | Dashboard, Reservations | Operational green with blue accent | High; fast scanning | Process queue | Organization inventory and reservations | Clinical approval, commercial internals, platform policy | Receive/adjust stock; confirm → ready → collect |
| Pharmacy Manager | `/pharmacy` | Manage pharmacy operations | Organization operations and exceptions | Overview, Reservations | Executive navy/teal with green accent | High; management-oriented | Review operations | Pharmacy inventory, staff, reservations | Other organizations and platform governance | Inventory/staff oversight and exception resolution |
| MedLink Admin | `/admin` | Govern the MedLink network | Network/catalogue/control health | Network Overview, Organizations, Medicine Catalogue, Pharmacy Network, Inventory, Transactions | Dark navy/slate with MedLink blue | High; control-plane | Resolve governance exceptions | Organizations, catalogue, audit-oriented metadata | Licensed clinical decision | Network and catalogue governance |
| AI Agent / System Actor | No interactive portal | Assist deterministic governed tasks | None | None | None | Typed task payload only | Recommend / route | Explicit minimized task context | Direct persistence, final clinical approval, privilege escalation | Human-gated agent task execution |
| Provider | Deferred | Not admitted by MVP Constitution | None | None | None | N/A | N/A | None in active persona contract | All active portal routes | Requires scope amendment and ADR |
| Finance Ops | Deferred | Not admitted by MVP Constitution | None | None | None | N/A | N/A | None | All active portal routes | Requires scope amendment and domain contracts |
| Support Ops | Deferred | Runtime support capability is not a human persona | None | None | None | N/A | N/A | None | All active portal routes | Requires scope amendment and bounded remediation policy |

All active themes use shared semantic variables: `--persona-primary`,
`--persona-accent`, `--surface-page`, `--surface-card`, `--text-primary`,
`--text-muted`, `--status-success`, `--status-warning`, `--status-critical`, and
`--status-info`. Focus remains visible, and status components retain text labels
so color is never the sole signal.
