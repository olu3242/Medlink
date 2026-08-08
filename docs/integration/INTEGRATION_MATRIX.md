# MedLink RC1 Integration Matrix

## Status

Evidence date: 2026-08-01. This is a source-level integration baseline, not a
production certification. `Integrated` means the source contains a UI-to-runtime
path with compatible contracts. `Partial` means one or more required runtime
links are absent or unproven. `Blocked` means the deployed path cannot work as
currently composed.

## Platform-wide blockers

| ID | Finding | Evidence | Effect | Required closure |
| --- | --- | --- | --- | --- |
| INT-B01 | Portal migration to the approved gateway is incomplete | ADR 0008 selects `apps/web`; patient read routes have moved, other portal routes remain in legacy apps | Non-migrated portals still cannot be RC1 deployment targets | Move each route group and retire legacy deployment entrypoints after parity tests |
| INT-B02 | Gateway client is implemented, but legacy clients still contain absolute default origins | `apps/web/lib/api/*` enforces relative paths and forwards context; `apps/*/lib/api.ts` remains during migration | Migrated patient pages are same-host; legacy pages remain unsafe | Migrate remaining pages, then delete legacy wrappers and scan for zero hosts |
| INT-B03 | Gateway owns session refresh and correlation, but only migrated routes benefit | `apps/web/middleware.ts` plus ADR 0008 | Gateway slice has one boundary; remaining portals are not integrated | Complete route migration and add live auth/session tests |
| INT-B04 | Ready/collect/expiry fulfillment bindings remain incomplete | Canonical confirmation/decline now exists; professional ready/collect contracts still lack API/RPC bindings | Reservation can be accepted or declined but not complete fulfillment through UI | Implement atomic ready, collect, and expiry commands with live evidence |
| INT-B05 | Realtime UI subscriptions are absent | No Supabase Realtime subscription in portal production source | Workflow changes require navigation/revalidation | Versioned event-to-UI invalidation/subscription contract |
| INT-B06 | OCR deliberately returns zero-confidence placeholder output when no provider is configured | `apps/admin/lib/prescription-extraction.ts` | Upload can proceed, but extraction is not operational | Provider adapter, failure-safe configuration, and live evidence |
| INT-B07 | Experience registry already marks AI partial and conversation operation missing | `packages/api/src/experience-contracts.ts` | Agent and conversation acceptance criteria cannot pass | Implement and certify missing contracts; do not route around registry |

## Experience traceability

| Persona / page | Component or action | API contract | Workflow | Persistence / RPC | Events / notification / audit | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Marketing `/` | Landing content | none | none | none | none | Out of integration scope |
| Sign-in `/auth/sign-in` | Magic-link action | Supabase Auth | authentication | auth provider | provider session event; no RC1 E2E evidence | Partial |
| Gateway `/patient` | Request cards | `GET /api/v1/mar` / `patient.mar.list` | WF-006 | `medication_access_requests`, `medicines` | runtime evidence; read has no domain event | Source-integrated; live DB/auth pending |
| Gateway `/patient/mar/:id` | Status and timeline | `patient.mar.get`, `patient.mar.timeline` | WF-006 | MAR plus `mar_audit_events` | correlation IDs rendered from audit | Source-integrated; live DB/auth pending |
| Gateway `/patient/search` | Medicine inventory search | `patient.inventory.search` | WF-008 | `medicines`, `inventory_batches`, `pharmacy_locations` | no mutation; registry status partial | Source-integrated; live DB/auth pending |
| Gateway `/patient/reserve/:inventoryBatchId` | Canonical reservation form | `patient.reservation.create` | WF-009 | `reserve_inventory`, `reservations`, inventory lock | `inventory.locked.v1`, `reservation.created.v1`, runtime evidence | Source/build integrated; live DB and realtime pending |
| Gateway `/patient/notifications` | Notification list | `patient.notification.list` | WF-012 | `notifications` | notification rows and correlation IDs | Source-integrated; live DB/auth pending |
| Pharmacy `/` | Inventory table | `pharmacy.inventory.list` | WF-008 | `inventory_batches`, medicine/location joins | read only; registry partial | Blocked by B01–B03 |
| Gateway `/pharmacy/reservations` | Queue | `pharmacy.reservation.list` | WF-009 | `reservations` | read through canonical runtime | Source/build integrated; live auth pending |
| Gateway `/pharmacy/reservations` | Confirm/decline | `pharmacy.reservation.decide` | WF-009 | `decide_reservation`, `fulfillment_transitions`, `inventory_locks` | confirmed/cancelled event plus runtime evidence | Source/build integrated; live DB pending |
| Pharmacist `/` | Review queue | `pharmacist.review.list` | WF-007 | `clinical_reviews`, MAR, prescription | registry partial | Blocked by B01–B03 |
| Pharmacist `/review/:id` | Review detail | `pharmacist.review.get` | WF-007 | `clinical_reviews` | read only | Blocked by B01–B03 |
| Pharmacist decision form | Approve/reject/needs info | `pharmacist.review.decide` | WF-007 | `decide_clinical_review` | MAR transition/runtime evidence | Partial; auth routing and realtime absent |
| Provider `/prescriptions/new` | Prescription submission | `provider.prescription.create` | WF-003 | provider integration adapter | contract registry partial | Partial |
| Provider `/referrals/new` | Referral submission | no experience contract evidenced | unregistered | unverified | unverified | Blocked |
| Admin `/catalog` | Catalog list/filter | `GET /api/v1/medicines` | administrative catalog | `medicines` | runtime evidence | Blocked by B01–B03 |
| Admin `/medicine/new` | Create medicine | `POST /api/v1/medicines` | administrative catalog | `create_medicine_record` | runtime evidence and audit | Partial; MERDP migration pending |
| Admin `/medicine/:id` | View/update medicine | `GET/PATCH /api/v1/medicines/:id` | administrative catalog | `update_medicine_record` | runtime evidence and audit | Partial; MERDP migration pending |
| Admin API | Prescription extract | `POST /api/v1/prescriptions/:id/extract` | prescription parsing | prescription repository | logging audit; placeholder OCR under B06 | Partial |
| Dashboard `/` | Patient overview | `GET /api/v1/dashboard` | aggregate read | implementation not found in app route tree | none proven | Blocked |
| Dashboard `/payments` | Payment history | `GET /api/v1/payments` | payments | implementation not found in app route tree | none proven | Blocked |
| Dashboard `/adherence` | Adherence | `GET /api/v1/adherence` | adherence | implementation not found in app route tree | none proven | Blocked |
| Dashboard `/notifications` | Notices | `GET /api/v1/notifications` | WF-012 | conflicts with patient notification representation | none proven | Blocked |
| Developer `/clients` | Client manager | developer API client | integration management | unverified route topology | unverified | Partial |
| Developer `/webhooks` | Webhook manager | developer API client | integration management | unverified route topology | unverified | Partial |
| Web WhatsApp webhook | Inbound messages | `/api/whatsapp/webhook` | conversation workflows | conversation/workflow stores | runtime events and audit paths have tests | Source-integrated; live provider unproven |
| Web runtime routes | Diagnostics/evidence/certification | `/runtime/*` | runtime certification | runtime evidence repositories | diagnostic evidence | Source-integrated; deployment evidence pending |

## API coverage summary

The canonical registry in `packages/api/src/experience-contracts.ts` is the
starting authority. It currently declares 16 experience operations: nine
`available`, six `partial`, and one `missing`. Source availability does not
overrule deployment blockers B01–B03.

Unregistered UI calls MUST NOT be normalized by merely adding proxy endpoints.
They first require workflow ownership, permission, request/response schema,
transaction, audit, event, idempotency, and recovery contracts.

## Mock and placeholder review

No production business-data arrays labeled mock/fake/demo were found in the
portal source scan. UI input placeholders are instructional text and are not
mock data. Test fakes/fixtures remain appropriate in tests. The configured-null
OCR implementation is a real operational gap because it returns placeholder
extraction fields through a production path.

## Next integration slice

The first safe slice is the gateway/session contract, not a page rewrite:

1. select the public application/gateway topology;
2. route all `/api/v1/*` contracts to a single authenticated boundary;
3. forward cookie/bearer, tenant, correlation, and idempotency headers;
4. refresh sessions at that boundary;
5. add contract tests proving patient, pharmacy, pharmacist, and admin calls
   arrive at the intended handler with tenant identity intact;
6. only then certify individual screens.
