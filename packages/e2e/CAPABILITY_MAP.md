# MedLink Persona E2E Capability Map

This map is evidence for the certification engine. It distinguishes browser-complete production paths from domain foundations and absent interfaces. Test fixtures establish preconditions only; workflow transitions continue through authenticated application and provider paths.

| Persona/capability | Production surface | Certification evidence | Current classification |
| --- | --- | --- | --- |
| Patient authentication/session recovery | Patient auth routes and middleware | `auth.spec.ts` | Implemented |
| Patient discovery/prescription/reservation/payment/tracking | Patient UI/API, storage scanner, payment adapter | `golden-loop.spec.ts`, `payment-refund.spec.ts` | Implemented |
| Pharmacy owner onboarding/location | Partner web UI and pharmacy handoff | `production-onboarding.spec.ts`, `partner-engine.spec.ts` | Implemented |
| Pharmacy staff fulfillment | Pharmacy reservation UI/API and fulfillment RPCs | `golden-loop.spec.ts` | Implemented |
| Pharmacist review | Pharmacist review UI/API and licensed-profile RLS | `golden-loop.spec.ts` | Implemented |
| Inventory manager manual operations | Pharmacy inventory APIs/RPCs | Runtime/live tests; no dedicated persona UI journey | Foundation only |
| Inventory CSV/XLSX import | No authoritative browser import found | None | Not implemented |
| Provider prescription workflow | Provider authoring forms exist; patient identification/signing handoff is incomplete | Build/component coverage only | Foundation only |
| Partner applicant/reviewer | Partner UI/API and governed lifecycle | `partner-engine.spec.ts`, `production-onboarding.spec.ts` | Implemented |
| Tenant/platform administration | RBAC/RLS and administration domain packages | Security/runtime tests; no complete browser member lifecycle | Foundation only |
| Finance/refund/settlement | Payment, refund, payable and settlement domain paths | `payment-refund.spec.ts`, `golden-loop.spec.ts` | Partially browser-complete |
| Alice | Patient assistant API and governed runtime/tool policies | Golden loop plus agent-governance tests | Implemented with clinical boundary |
| WhatsApp | Signed webhook, channel identity, shared discovery workflow | `golden-loop.spec.ts` and provider tests | Implemented locally |

## Canonical roles

The fixture engine uses only database enum values: `platform_admin`, `tenant_admin`, `pharmacist`, `provider`, `pharmacy_owner`, `pharmacy_staff`, `inventory_manager`, and `patient`. Partner applicant is deliberately unaffiliated before approval. Partner reviewer and finance duties currently use platform-admin authority because no separate production enum exists.

## Deployment origins

`E2E_TARGET` supports `local`, `preview`, and `staging`. Deployed targets require explicit per-application origins such as `MEDLINK_E2E_PREVIEW_PATIENT_URL`; they never silently fall back to localhost. Full deployed workflows additionally require a safe Supabase service credential and configured external providers.
