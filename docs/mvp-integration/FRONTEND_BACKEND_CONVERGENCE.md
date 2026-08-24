# Frontend/backend MVP convergence

This is the release-path UI contract inventory for the patient, pharmacist, and pharmacy applications. `CONNECTED` means the screen waits for an authenticated canonical API response and reloads or renders its returned domain state; authorization and tenant scope remain server-side.

| Persona | Screen | User action | UI handler / data source | Expected API or service | Domain authority | Persistence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Patient | Sign in | Request magic link | Server action / Supabase Auth | Supabase authenticated session | Auth service + membership resolver | Auth session | CONNECTED |
| Patient | My requests / request detail | View workflow and timeline | Server API client | `GET /api/v1/mar[/id][/timeline]` | `AccessApplication` | MAR + audit events | CONNECTED |
| Patient | Add prescription | Upload PDF/JPEG/PNG | Multipart `fetch` | `POST /api/v1/prescriptions` | `PrescriptionIntakeService` | Private object + prescription file + workflow | CONNECTED |
| Patient | Ask Alice | Ask platform/workflow question | `AssistantPanel` | `POST /api/v1/assistant` | `AliceAgent` through AI gateway and guardrails | AI evidence / escalation when required | CONNECTED |
| Patient | Find nearby | Consent and share coordinates | Browser geolocation + API | `GET /api/v1/inventory` | `AccessApplication.eligiblePharmacies` | Inventory read + agent evidence | CONNECTED |
| Patient | Discovery results | View exact/generic/both/none | Canonical response rendering | `GET /api/v1/inventory` | `classifyMedicationDiscovery` | Canonical inventory / medicine governance | CONNECTED |
| Patient | Discovery results | Select eligible exact inventory | Mutation then navigation | `POST /api/v1/mar/:id/match` | MAR matching service | MAR state + audit | CONNECTED |
| Patient | Reservation review | Request reservation | `fetch`, success only after 201 | `POST /api/v1/reservations` | reservation coordinator + atomic reservation RPC | Reservation + inventory lock + events | CONNECTED |
| Patient | Reservations | View payment/fulfilment state | Canonical list response | `GET /api/v1/reservations` | patient-scoped query | Reservation + payment relation | CONNECTED |
| Patient | Reservations | Start payment | Stable retry key + `fetch` | `POST /api/v1/payments` | payment application/provider adapter | Payment + attempt | CONNECTED |
| Patient | Reservations | Generate pickup credential | Browser hash + authenticated mutation | `POST /api/v1/reservations/:id/credential` | credential issuance RPC | Hash only | CONNECTED |
| Patient | Notifications | View workflow messages | Server API client | `GET /api/v1/notifications` | notification/outbox query | Notification deliveries | CONNECTED |
| Pharmacist | Review queue | View assigned reviews | Server API client | `GET /api/v1/review` and dashboard | clinical review application | Clinical reviews | CONNECTED |
| Pharmacist | Prescription review | Resolve extracted items and decide | API search/availability + PATCH | `/api/v1/medicines/search`, `/inventory/availability`, `/review/:id` | clinical review service | Resolution + decision + audit | CONNECTED |
| Pharmacist | Access review | Approve/reject generic governance | Authenticated PATCH | `PATCH /api/v1/access-reviews/:id` | medication access review application | Review + MAR transition | CONNECTED |
| Staff | Inventory | Receive/update/adjust stock | API helper + canonical reload | `/api/v1/inventory` and stock/transactions routes | inventory application/RPCs | Batches + immutable ledger | CONNECTED |
| Staff | Reservations | View queue/payment state | Authenticated list | `GET /api/v1/reservations` | pharmacy reservation query | Reservations + payment state | CONNECTED |
| Staff | Reservations | Confirm/decline | PATCH then canonical reload | `PATCH /api/v1/reservations/:id` | `decideReservation` | Reservation transition + outbox | CONNECTED |
| Staff | Reservations | Mark ready | POST then canonical reload | `POST /api/v1/reservations/:id/ready` | `markReservationReady` | Reservation transition + outbox | CONNECTED |
| Staff | Reservations | Verify collection | POST then canonical reload | `POST /api/v1/reservations/:id/collect` | `collectReservation` | Fulfilment + lock + MAR + outbox | CONNECTED |

## Release-path audit

- Production route scan found no mock, fixture, demo, random domain truth, timer-based success, or browser storage used as authority. The sole storage-keyword match is a comment explicitly forbidding pickup credentials in browser storage.
- The patient assistant API previously lacked a release-facing screen; `/assistant` now binds it without sending identity, persona, tenant, tools, or privileges from the browser.
- Reservation expiry is now assigned at the authenticated API boundary, not accepted from the browser.
- Payment retry identity is stable across network retries in one mounted action, preventing duplicate attempts caused by a lost response.
- Pharmacy mutations reload the canonical reservation queue before displaying persisted success; rejected and network-failed mutations never project a successful local state.
- Raw prescription documents remain outside the pharmacy-staff UI and are denied by the existing private-document access policy.
- Shared domain types are used for discovery, pharmacist reviews, and inventory. The remaining small view models are projections of API responses rather than alternate domain authorities.
