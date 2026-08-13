# RC2 Gap Analysis

Date: 2026-07-31

## P0 - MVP blockers

| ID | Gap | Evidence | Required closure |
| --- | --- | --- | --- |
| P0-002 | Reservation path cannot execute from UI | Patient UI sends only `inventoryId`; API requires MAR, pharmacy, batch, quantity, key, expiry | Complete `WF-009` after certified inventory projection |
| P0-003 | Search does not return nearby sellable inventory | Patient endpoint ignores `q`; UI expects distance fields that API does not provide | Join catalogue, pilot-LGA pharmacy distance and FEFO availability through one use case |
| P0-004 | WhatsApp primary journey is not deployed | No webhook route, persistent store adapter, workflow router, delivery worker or provider evidence | Complete communication only after domain path is executable |
| P0-006 | Live tenant isolation is unproven for RC2 migrations | Docker unavailable; live suite skipped | Apply migrations and run authenticated allow/deny matrix in isolated Supabase |

## Closed in the Batch 2 source checkpoint

| ID | Result | Evidence | Residual condition |
| --- | --- | --- | --- |
| P0-001 | IMPLEMENTED | `ML-CAP-008` / `ML-WF-008` migration, domain/repository, pharmacy API/UI, immutable ledger, FEFO projection, expiry recovery and focused tests | Runtime validation remains pending under P0-006; patient nearby matching belongs to Batch 3 |
| P0-005 | IMPLEMENTED | Ingredient and pharmacy-location routes now delegate through package application/repository boundaries; architecture suite passes | Must remain green in the final full suite |

## P1 - MVP required

| ID | Gap | Required closure |
| --- | --- | --- |
| P1-001 | Pharmacy onboarding/approval is incomplete | Administer licensed pilot locations, hours, contact, coordinates and active status through governed APIs/UI |
| P1-002 | Pharmacist profile administration is incomplete | Govern license verification, expiry and tenant assignment independently of review decisions |
| P1-003 | Pickup/fulfilment lacks persistence-backed APIs | Implement stable `WF-010` transitions, lock consumption, pharmacy action and patient history |
| P1-004 | Notifications lack a production WhatsApp adapter | Consent, template, outbox, delivery receipt, retry and dead-letter evidence |
| P1-005 | Authentication is not a complete four-persona/channel journey | Add account linking/OTP and portal session evidence without adding personas |
| P1-006 | Provider integrations are unavailable | Configure scanner and OCR/parser, then retain conformance evidence |
| P1-007 | E2E and accessibility evidence is thin | Add browser/conversation acceptance for the four approved personas |

## P2 - RC2 enhancements

- Catalogue/search ranking refinements after the Golden Path is measurable.
- Additional pharmacist-assistance rules backed by clinical evaluation.
- Pilot dashboards limited to operational fulfilment metrics.
- Performance optimization after representative load evidence exists.

## P3 - post-MVP or prohibited without admission

- New personas, provider/hospital portal expansion, FHIR/OpenHIE and insurance.
- Payment-led commerce, marketplace, delivery fleet, procurement and loyalty.
- Population health, national analytics, predictive supply-chain optimization.
- Autonomous agents, planners, delegation, generalized memory, MAOS/MAIF, and
  configurable AI workspaces.
- Engines 36-40.

## Priority decision

The Batch 2 inventory source checkpoint is complete. The next dependency-safe
product slice is Batch 3: `ML-CAP-009` nearby search/matching followed by the
compatible `WF-009` reservation command. It is not started by this checkpoint.
P0-006 remains an independent certification blocker until the migrations and
authenticated tenant matrix execute against isolated Supabase.
