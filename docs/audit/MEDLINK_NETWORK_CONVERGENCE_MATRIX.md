# MedLink network convergence matrix

Date: 2026-08-18
Scope boundary: Partner-to-Patient E2E and resilience; excludes RC1/final release certification and production promotion.

| Domain | Authority / persistence | API and UI | Events / workflow / agents | Connected E2E and tests | Missing handoff / status |
| --- | --- | --- | --- | --- | --- |
| Partner | Partner Engine tables linked to `organizations` | `/partner`, portal, reviewer workbench, `/api/v1/partner/applications/**` | WF-016, lifecycle audit/outbox, advisory readiness agent | Partner unit/static/live/browser suites | New implementation; full browser pass required before certification. |
| Organization | `organizations`, `organization_memberships` | Existing tenant resolution | Runtime audit | Partner test proves one ID into pharmacy membership/location | Connected; duplicate identity is fail-closed. |
| Pharmacy | Organization type + pharmacy app | Existing pharmacy app/APIs | Existing pharmacy events | Existing browser golden loop; Partner test hands off same organization | Connected for canonical organization; no parallel pharmacy entity. |
| Location | `pharmacy_locations` | Existing location management | Partner location capability evidence | Partner live/browser test; independent multi-location state supported | Connected through derived readiness. |
| Inventory | `inventory_batches`, transactions, locks | Existing pharmacy management and availability RPC | Inventory outbox events | Existing inventory, reservation contention, expiry, and replay suites | No repository-approved universal freshness duration; evidence requires an explicit policy reference. |
| MERDP | Canonical medicines, source mappings, publications, manufacturer links | Existing medicine/search contracts | MERDP convergence events | Existing reference, wave, and medicine-identity suites | Pharmacy SKU mapping PR #35 remains draft and noncanonical. |
| Geo | `pharmacy_locations` coordinates and patient discovery contracts | Existing eligible-pharmacy flow | Orchestration only | Existing discovery classification tests | Radius policy remains repository-defined; no silent broadening added. |
| Discovery | `search_inventory_availability` + medication classification | Existing patient APIs/UI | WF-005/WF-008 | EXACT/GENERIC/BOTH/NONE existing golden loop | Now gates Partner-era locations through derived network eligibility; legacy locations remain explicitly marked. |
| Pharmacist | Clinical review/validation state and pharmacist profiles | Pharmacist app/APIs | WF-007; human-exclusive decisions | Existing bypass, stale, cross-tenant, and browser tests | Connected; Partner Engine gains no clinical authority. |
| Reservation | `reservations`, `inventory_locks`, atomic RPCs | Existing patient/pharmacy APIs | WF-009 + runtime events | Existing duplicate, expiry, 1-unit contention, decision-race, replay suites | Connected; discovery remains informational. |
| Payment | Canonical payment obligation/attempt/provider-event tables | Existing hosted initiation/webhooks | Payment/refund outbox | Existing success/refund/retry/provider authority tests | Reconciliation policy for ambiguous external states must remain operator-visible; no new financial state machine. |
| Fulfillment | Canonical reservation transitions | Pharmacy queue/actions | Fulfillment/outbox events | Existing READY/COLLECTED/concurrency/invalid-transition suites | Connected; Partner suspension does not mutate existing obligations. |
| Notification | Runtime outbox + notification dispatcher | Existing worker routes | Retry/dead-letter dispatch | Existing dispatcher and browser assertions | Connected; delivery failure cannot change transaction state. |
| Workflow OS | `workflow_instances`, WorkflowService | Internal orchestration | WF-001–WF-016 | Existing idempotency/recovery tests | Connected; never authoritative over domain truth. |
| Agentic OS | Governed agent registry/runtime evidence | Bounded runtime | Advisory Partner readiness/integration health only | Registry/governance tests | Connected; approval, medication match, payment, and collection cannot be fabricated. |

## Authority chain

`partner_application → organizations → organization_memberships → pharmacy_locations → inventory_batches → medicines/MERDP → discovery → clinical review → reservations/inventory_locks → payments → fulfillment → runtime outbox/notifications`

The Partner Engine owns relationship governance only. Each downstream domain remains authoritative for its own state.

## Derived network readiness

Partner `active` is deliberately independent from location `networkReady`. For Partner-era pharmacy locations, `partner_location_network_state(location_id)` derives readiness from:

- active Partner relationship;
- active canonical location and location license;
- independently verified location credential;
- healthy inventory integration;
- current inventory evidence with an explicit approved freshness-policy reference;
- eligible medication mapping;
- ready payment capability;
- ready fulfillment capability.

No `network_ready` column exists. Suspension or failed integration evidence removes the affected location from new canonical discovery while leaving reservations, payments, and fulfillment under their existing domain policies.

Pre-Partner Engine locations are returned as `legacyNetwork: true` to preserve the established medication-access baseline. This compatibility path is explicit and observable, not silently converted into a Partner relationship.

## Policy stop points

- `INVENTORY_FRESHNESS_POLICY_REQUIRED`: no universal duration exists in the repository. A location cannot be Partner-network-ready without a governed `freshness_policy_reference`, source timestamp, and last successful sync.
- `PARTNER_SUSPENSION_OBLIGATION_POLICY_REQUIRED`: suspension blocks new discovery. It intentionally does not cancel or mutate existing obligations; any bulk cancellation policy requires a separate authorized decision.
- `PAYMENT_RECONCILIATION_POLICY_REQUIRED`: canonical payment tables expose uncertain states, but the Partner wave does not invent provider reconciliation outcomes.
- `BACKUP_POLICY_REQUIRED` / `RECOVERY_POLICY_REQUIRED`: local database reset/restart proves migration persistence mechanics, not production backup/restore or rollback policy.
