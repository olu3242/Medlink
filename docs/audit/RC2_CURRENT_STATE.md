# RC2 Current State

Date: 2026-07-31  
Branch: `rc2-development`  
Baseline HEAD: `d33bd6858e46952083dee4324a16eb90064b816d`

This report describes the checked-out repository and working tree. It does not
promote documentation claims to implementation evidence.

## Governing boundary

The approved MVP Constitution and ADR-0008 narrow older RC1 documents to four
personas and twelve prescription-fulfilment capabilities. ADR-0003 preserves
Conversation-Driven Architecture and stable `WF-*` identifiers. ADR-0009 makes
the deterministic Agent Runtime Contract (ARC) the only approved AI task
runtime. There is no accepted MAOS or MAIF implementation in this repository.

Frozen or stable contracts include the Enterprise Runtime lifecycle, tenant
and membership model, `/api/v1` compatibility, canonical business objects,
published workflow/event identities, transactional outbox, RLS, and mandatory
pharmacist authority. Autonomous orchestration, new personas, payment-led MVP
flows, delivery fleets, FHIR/OpenHIE, hospital integration, insurance,
population health, national analytics, and Engines 36-40 are deferred.

## Repository inventory

| Inventory | Evidence |
| --- | ---: |
| Applications | 8 workspaces |
| Packages | 29 workspaces |
| Ordered migrations | 21 |
| Created public tables | 76 |
| Tables with RLS enabled in source | 76 |
| Public SQL function definitions | 70 statements |
| Application API route files | 59 |
| HTTP route handlers | 76 |
| Application pages | 33 |
| Versioned event contracts | 47 |
| Legacy canonical workflows | 15 |
| MVP clinical/catalogue workflow definitions | 7 |
| Test files | 113 |
| Markdown documents | 88 including the audit/evidence set |

### Applications

| Application | Actual role | State |
| --- | --- | --- |
| `apps/web` | shared authentication, health, runtime evidence, clinical worker | Implemented foundation; provider configuration and live evidence blocked |
| `apps/patient` | patient profile, catalogue, prescription, clarification, MAR, search and reservation fallback web | Profile/prescription/catalogue/clarification are substantive; nearby search/reservation are not E2E |
| `apps/pharmacist` | clinical-review workspace, canonical resolution, clarification and read-only availability | Batch 2 source implemented; live authorization/RLS blocked |
| `apps/pharmacy` | inventory management and reservation portal | Batch 2 inventory APIs/UI implemented; reservation remains incompatible legacy work |
| `apps/admin` | medicine catalogue administration | Substantive catalogue slice behind application/repository boundaries |
| `apps/dashboard` | legacy payment/adherence/notification dashboard | Scaffolded and outside active MVP priority |
| `apps/developer` | legacy integration/client portal | Scaffolded; partner integrations are deferred |
| `apps/provider` | legacy provider/referral portal | Conflicts with the four-persona MVP boundary; deferred |

### Package groups

- Active MVP/domain packages: `patients`, `medicine`, `prescription`,
  `clinical`, `inventory`, `search`, `reservations`, `pharmacy`,
  `conversation`, `whatsapp`, and `notifications`.
- Shared certified-boundary packages: `platform`, `api`, `runtime`,
  `observability`, `workflows`, `agent-runtime`, `database`, `ui`, and
  `security`.
- Historical or post-MVP packages: `payments`, `adherence`, `analytics`,
  `reporting`, and broad partner-integration features. Governance and
  certification packages remain usable as controls but do not authorize their
  historical product scope.

Package presence is not completion. For example, `conversation` contains one
small in-memory service, `notifications` has no production adapter, and
`reservations` has no persistence adapter or professional API implementation.
The `inventory` and `pharmacy` packages now expose Batch 2 application and
repository boundaries, but still require live migration/RLS validation.

## Data and runtime

The migrations define tenant identity, medicine/catalogue, prescription and
clinical evidence, pharmacy/inventory/reservation, conversation, notification,
runtime journal/outbox/dead-letter, audit, observability, and certification
storage. All 74 created public tables enable RLS in source. That is static
posture only: this machine cannot run the Docker-backed Supabase stack, so the
new RC2 migrations and authenticated cross-tenant behavior are not certified.

Protected application routes use `runApi` for authentication,
membership-backed tenant resolution, RBAC, validation, correlation, telemetry,
and runtime evidence. The two route/application separation defects found by
the initial audit were corrected behind medicine and pharmacy package
boundaries; the architecture test passes in the focused Batch 2 gate.

## Integrations and runtime workers

| Integration | Executable evidence | State |
| --- | --- | --- |
| Supabase Auth/PostgREST/Storage | shared clients, repositories, RPCs | Implemented; live RC2 migration evidence blocked |
| File malware scanner | bounded HTTP adapter | Implemented contract; endpoint/credentials unavailable |
| OCR and parser | bounded HTTP adapters behind ARC | Implemented contract; endpoint/credentials unavailable |
| Clinical worker | service-role, token-protected internal route and fenced claims | Source implemented; deployed execution blocked |
| Inventory expiry worker | service-role, token-protected bounded expiry command | Source implemented; deployed schedule/live recovery blocked |
| WhatsApp | signature normalizer, in-memory journey contract/tests | Partial; no webhook route, persistent adapter, delivery worker, or provider evidence |
| Search | Supabase catalogue RPC and inventory availability adapters | Pharmacist read-only availability is integrated; patient nearby matching remains Batch 3 |
| Payment/FHIR/HL7/partner adapters | ports, UI scaffolds, certification contracts | Deferred; not MVP completion evidence |

## Validation checkpoint

| Command | Result |
| --- | --- |
| `git pull --ff-only` | PASS - already up to date |
| `npm.cmd ls --depth=0` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS |
| Focused Batch 2 tests | PASS - domain, migration, event, architecture and acceptance suites |
| `npm.cmd test -- --reporter=verbose` | Pending final Batch 2 gate |
| `npm.cmd run test:coverage` | Pending final Batch 2 gate |
| `npm.cmd run build --workspaces --if-present` | Pending final Batch 2 gate; pre-change baseline passed all 8 applications |
| `npx.cmd supabase status` | BLOCKED - Docker Desktop Linux engine is unavailable |

Final full-suite totals are recorded only after the Batch 2 checkpoint is
complete. The secret-gated live database suite remains unavailable while the
local Docker-backed Supabase runtime cannot start.

## Evidence-based completion

- **Source-complete capability slices: 5 of 12 (42%)**: Patient Management,
  Medicine Catalogue, Prescription Intake/Management, Clinical Review, and
  Pharmacy Inventory.
  Each still has a live-environment certification condition.
- **Production-certified MVP capabilities: 0 of 12 (0%)**: no capability has
  current authenticated RC2 migration/RLS and provider-backed E2E evidence.
- **Golden path:** executable in source through pharmacist-owned canonical
  medicine resolution and read-only tenant inventory availability, then stops
  before patient nearby matching and reservation.

Batch 2 is **IMPLEMENTED; RUNTIME VALIDATION PENDING**. Source completion does
not make it a production-certified baseline.
