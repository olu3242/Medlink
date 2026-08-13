# RC2 E2E Trace

Date: 2026-07-31

## Shared execution boundary

For protected REST entry points, `packages/api/src/index.ts` supplies
authentication, membership-backed tenant resolution, RBAC, Zod validation,
correlation/request IDs, runtime tracing/metrics, and the
`record_runtime_evidence` journal. Business commands then use package services,
Supabase repositories, and atomic RPCs. PostgreSQL RLS remains the final
boundary. Static tests prove route and migration shape; live authenticated RLS
is currently blocked.

## Capability traces

| Capability | Actual trace | Missing mandatory stages | Status |
| --- | --- | --- | --- |
| Identity | user -> web sign-in/callback -> Supabase Auth -> membership query -> shared role permission -> runtime context/evidence | WhatsApp identity link/OTP, four-persona portal session evidence, live cross-tenant tests | PARTIAL |
| Patient | patient fallback UI -> `runApi` -> `PatientService` -> Supabase patient repository -> `patient_profiles` -> runtime evidence -> response | Canonical workflow event and live RLS/E2E | PARTIAL |
| Pharmacy | pharmacy/admin -> location schema or small discovery service -> `pharmacy_locations` | governed onboarding/approval service, complete APIs/UI, events, recovery | PARTIAL |
| Pharmacist | pharmacist workspace -> review API -> `PharmacistReviewService` -> catalogue resolution/read-only availability -> repository -> decision RPC -> clinical tables/outbox/audit; patient clarification requeues a fresh review | profile/license administration and live verified-pharmacist/RLS proof | BLOCKED |
| Medicine | admin/patient UI -> catalogue API -> `CanonicalMedicineCatalog` -> Supabase repository -> catalogue RPCs/tables -> outbox/audit -> runtime evidence -> response | live migration, idempotency, admin and RLS execution | BLOCKED |
| Prescription | patient UI -> intake API -> scanner ARC task -> private storage -> atomic intake RPC -> fenced OCR/parsing ARC tasks -> clinical packet -> review queue -> events/audit/telemetry | configured providers, live storage/RLS/worker execution, WhatsApp channel | BLOCKED |
| Clinical Review | pharmacist UI -> authenticated review API -> canonical per-item resolution -> review service/repository -> verified-pharmacist decision RPC -> immutable resolution/evidence/findings/state/outbox/audit -> response or protected clarification loop | live license, acknowledgement, RLS and concurrent-decision proof | BLOCKED |
| Inventory | pharmacy UI/API -> `InventoryManagement` -> Supabase repository -> atomic inventory RPCs -> batch plus immutable transaction ledger/outbox/audit; pharmacist gets read-only FEFO availability | patient nearby search/matching plus live migration/concurrency/RLS | BLOCKED |
| Search | patient page -> patient inventory route -> direct inventory query; separate catalogue search service/RPC exists | query is ignored by inventory route; no distance/FEFO join, event/evidence, or matching UI contract | PARTIAL |
| Reservation | patient UI -> incompatible JSON -> reservation API -> `reserve_inventory` RPC -> reservation/lock tables | request contract cannot execute; no complete repository/workflow, pharmacy actions, notifications or history | PARTIAL |
| Communication | test payload -> signature verifier -> in-memory journey/store/provider ports -> reply | deployed webhook, verification handshake, persistence, identity, workflow router, outbox delivery, receipts, audit/telemetry | MISSING |
| Administration | admin catalogue UI -> catalogue APIs/commands -> catalogue tables/evidence | pharmacy/pharmacist approvals, pilot operations/support, complete route separation | PARTIAL |

## Mandatory-stage findings

- **Authentication / tenant / RBAC:** shared `runApi` is substantive, but live
  membership and RLS denial are not currently executable here.
- **Workflow:** clinical workflow RPCs are durable. The generic `WorkflowService`
  test does not prove each of the fifteen workflows end to end.
- **Agent/AI:** ARC is deterministic and bounded. It has no authority to bypass
  policy, clinical review, transactions, inventory rules, or audit.
- **Transactions/events:** clinical, catalogue, reservation and inventory
  mutations use database functions and outbox evidence. Inventory stock
  commands atomically update totals and the immutable ledger. Older direct
  application queries and scaffolded engines remain incomplete.
- **Notifications:** notification schema/service exists, but no production
  WhatsApp delivery adapter closes the loop.
- **Recovery:** fenced clinical jobs, outbox/dead-letter primitives and
  fulfilment compensation exist. Most portal/domain paths lack E2E recovery
  evidence.
- **User-visible failure:** runtime problem responses are safe and correlated;
  several legacy UIs collapse failures to generic text and cannot recover.

No capability is marked `COMPLETE` E2E until its entire trace executes against
the isolated RC2 data boundary and applicable provider.
