# Engine Status Matrix

Status reflects executable source and evidence, not directory names.

| Engine | Wave | Status | Certification | Blocking issues | Next action |
| --- | --- | --- | --- | --- | --- |
| Identity and Tenant Context | 1 | Partial | Conditional | Canonical context now used by `apps/admin`, `apps/patient`, and `apps/web`; no live-RLS evidence | Execute and test migrations, then freeze |
| RBAC | 1 | Partial | Conditional | Role map enforced in every route's API pipeline call; no live authorization-denial evidence | Add live RLS/RBAC denial matrix |
| Database Platform | 1 | Partial | Conditional | Strong static migration; no runtime/RLS evidence | Execute and test migrations |
| Observability | 1 | Scaffolded | Conditional | Logger, correlation, and real (non-hardcoded) dependency-aware health checks exist; no metrics/tracing dashboards or SLOs | Add propagation, metrics, traces, alerting |
| Medicine Knowledge | 2 | Partial | Conditional | Domain/catalog schema exists; create/update commit business state and evidence atomically (migration 008); read paths still bypass `packages/medicine`, blocked on the no-generic-entity schema gap (see `docs/wave-2-certification.md`), not just missing wiring | Resolve generic-entity gap, then wire read paths |
| Medication Equivalency | 2 | Partial | Conditional | Safety unit tests pass; tenant review workflow now wired end-to-end (`PATCH /api/v1/equivalents/{id}/review`, migration 009, `CatalogEquivalencyService.assertReviewed`); no integration/RLS tests | Add integration/RLS tests |
| Prescription Intelligence | 2 | Partial | Conditional | Parser now wired end-to-end (`POST /api/v1/prescriptions/{id}/extract`, migration 009) against a placeholder reader; OCR adapter still unselected | Select/configure OCR provider |
| Clinical Intelligence | 2 | Partial | Conditional | Validation rules now wired end-to-end (`POST /api/v1/prescriptions/{id}/validate`, migration 009); still only one rule (`DuplicateTherapyRule`) | Expand clinical rule set |
| Search | 2 | Partial | Conditional | `GET /api/v1/search` now wired against a real trigram index adapter for brand medicines; no generic-type results (no generic entity to index) and no production-scale index evidence | Resolve generic-entity gap; load-test the trigram index |
| Conversation Engine | 3 | Not started | Fail | No package, schema, API, or tests | Wave 3 |
| Workflow Orchestrator | 3 | Scaffolded | Fail | Generic step runner; no canonical workflows or recovery model | Wave 3 |
| WhatsApp Adapter | 3 | Not started | Fail | No webhook/media/identity/delivery implementation | Wave 3 |
| Medication Access Request | 3 | Partial | Conditional | Strong domain/database rules; direct-DB routes bypass service | Wave 3 integration |
| Pharmacy Discovery | 3 | Partial | Conditional | Domain service and schema; no adapter/integration evidence | Wave 3 integration |
| Inventory | 3 | Partial | Conditional | Locking model exists; no runtime concurrency tests | Wave 3 integration |
| Reservation | 3 | Partial | Conditional | Compensation unit test; state vocabulary differs across layers | Reconcile state model |
| Notification | 3/5 | Partial | Conditional | Service/outbox schema; TS service omits WhatsApp channel | Add channel-neutral contracts in Wave 3 |
| Pharmacy Portal | 4 | Scaffolded | Fail | UI calls missing APIs; no auth/RBAC evidence | Wave 4 |
| Pharmacist Portal | 4 | Scaffolded | Fail | UI calls missing decision API | Wave 4 |
| Hospital Portal | 4 | Scaffolded | Fail | Provider UI calls missing APIs | Wave 4 |
| Administrator Portal | 4 | Partial | Conditional | Catalog UI/API exists; API pipeline now conformant repository-wide | Wave 4 |
| Payment | 5 | Partial | Conditional | Token boundary exists; no provider adapter/runtime tests | Wave 5 |
| Adherence | 5 | Scaffolded | Fail | Minimal service and UI; no canonical workflow | Wave 5 |
| AI Coordinator | 5 | Partial | Conditional | Safety wrapper exists; agent catalog incomplete | Align agent catalog |
| Analytics and Reporting | 5 | Scaffolded | Fail | Privacy suppression primitives only | Wave 5 |
| Governance and Consent | 5 | Partial | Conditional | Schema/service primitives; no end-to-end audit integration | Wave 5 |
| Partner Integrations | 5 | Scaffolded | Fail | Typed ports and webhook guard only | Wave 5 |
| Security | 5 | Scaffolded | Fail | Policy primitive and schema; no operational controls evidence | Wave 5 |
| Certification | 5 | Scaffolded | Fail | Generic runner only; no registered certification suite | Build evidence-driven suite |
| Developer/Operations Portal | 5 | Scaffolded | Fail | UI calls missing enterprise APIs | Wave 5 |

No engine is fully certified. Wave 1 is functionally established but remains
conditionally certified until route conformance and runtime infrastructure
evidence are complete.
