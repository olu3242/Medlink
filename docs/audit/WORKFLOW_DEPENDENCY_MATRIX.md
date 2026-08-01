# RC1 Workflow Dependency Matrix (Engine 34)

Companion to `WORKFLOW_CATALOG.md` -- one row per canonical workflow,
listing exactly what it depends on and what evidence exists. "Owner" is a
package/app, not a person (no per-engineer ownership model exists in this
repository). A blank cell means "none found," verified by grep/read, not
assumed absent.

| Workflow | Owner (package/app) | Runtime services | APIs | Database objects | Events emitted | Tests | Docs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WF-001 Patient Registration | -- | Supabase Auth (not this repo's code) | -- | `auth.users` (GoTrue-managed) | -- | none | this catalog only |
| WF-002 Authentication | `apps/web/app/auth` | `createRuntime()`'s `authenticate()` via `resolveRequestContext`/`requestDatabase` | `apps/web/app/auth/sign-in`, `/auth/callback` | `auth.users`, `organization_memberships` | -- | none workflow-specific | this catalog only |
| WF-003 Prescription Upload | `packages/workflows`, `apps/patient` | `PrescriptionIntakeApplication`, `SupabasePrescriptionFileStore` | `POST /api/v1/prescriptions` | `prescriptions` (migration `202607270002`, extended `202608010003`), `storage.objects`/`storage.buckets` | `prescription.uploaded` (`record_runtime_evidence` inside `create_prescription_record`) | `prescription-upload.test.ts`, `prescription-intake.test.ts`, `prescription-storage.test.ts`, `file-intake.test.ts` | `docs/audit/PRESCRIPTION_INTAKE_CERTIFICATION.md` |
| WF-004 Prescription Parsing | `packages/workflows`, `apps/admin` | `SupabasePrescriptionRepository` | `POST /api/v1/prescriptions/{id}/extract` | `prescription_extractions`, `prescription_extracted_fields` (migration `202607290009`) | `prescription.extracted` | `prescription-parsing.test.ts` | `docs/audit/RC1_BACKLOG.md` item 8 |
| WF-005 Medicine Search | `packages/workflows`, `packages/search`, `apps/admin` | `IndexedMedicineSearchService`, `TrigramMedicineSearchIndex` | `GET /api/v1/search` | `medicines`, `generics` (trigram-indexed) | -- (read-only) | `medicine-search.test.ts`, `service.test.ts` (search) | `docs/wave-2-certification.md` |
| WF-006 Medication Access Request | `packages/workflows`, `apps/patient` | `AccessApplication.createMar()` | (no dedicated MAR-create route found; called from `AccessApplication`) | `medication_access_requests`, `mar_audit_events` (migration `202607270003`, `202607290016`, `202607290018`) | `mar.created`, `mar.validated` | `mar-creation.test.ts` | `docs/audit/RC1_BACKLOG.md` items 3, 19 |
| WF-007 Clinical Review | `packages/workflows`, `packages/clinical`, `apps/admin`, `apps/patient` | `ClinicalAcknowledgementService`, three `ClinicalRule` implementations | `POST /api/v1/prescriptions/{id}/validate`, `PATCH /api/v1/review/{id}` | `clinical_validations`, `clinical_findings`, `clinical_reviews` (migrations `202607290009`, `202607290017`) | `clinical_validation.recorded`, `clinical_review.decided` | `clinical-review.test.ts`, `validation.test.ts` | -- |
| WF-008 Inventory Discovery | `packages/workflows`, `apps/patient` | `PharmacyDiscoveryService` (domain) | `GET /api/v1/inventory` | `pharmacy_locations`, `inventory_batches` | -- (read-only) | `inventory-discovery.test.ts` | `docs/audit/RC1_BACKLOG.md` item 19 |
| WF-009 Reservation | `packages/workflows`, `apps/patient` | `AccessApplication.reserve()` | `POST /api/v1/reservations` | `reservations`, `inventory_locks` (migration `202607290010`, replay-hardened `202607290020`) | `reservation.created` | `reservation.test.ts` | `docs/audit/ENGINE_STATUS_MATRIX.md` Reservation row |
| WF-010 Pickup | -- | -- | -- | -- | -- | none | -- |
| WF-011 Delivery | -- | -- | -- | -- | -- | none | Wave 5/RC2 scope per `docs/release-scope.md` |
| WF-012 Medication Reminder | -- | -- | -- | -- | -- | none | Blocked on G09 (see `LAUNCH_GAP_MATRIX.md`) |
| WF-013 Consultation | -- | -- | -- | -- | -- | none | -- |
| WF-014 Refill | -- | -- | -- | -- | -- | none | -- |
| WF-015 Workflow Completion | -- | -- | -- | -- | -- | none | -- |
| *(non-WF) WhatsApp Conversation Runtime* | `packages/conversation`, `packages/whatsapp`, `apps/web` | `ConversationEngine`, `createRuntime()` | `POST`/`GET /api/whatsapp/webhook` | `conversations`, `conversation_messages`, `conversation_events`, `conversation_channel_bindings`, `auth.users` (system identity) | `conversation.whatsapp.receive` (telemetry), `message_received`/`intent_detected`/`handoff_requested`/`workflow_invoked` (event log) | `whatsapp-webhook.test.ts` (13), `service.test.ts` (conversation), `signature.test.ts`, `payload.test.ts` | `docs/audit/WHATSAPP_RUNTIME_CERTIFICATION.md` |
| *(non-WF) Agent Governance Layer* | `packages/agents` | `authorizeAgentCapability`, `toSupervisedWorkflowSteps` | none (no route) | `agent_memory_entries`, `agent_escalations` | `agent_escalation.raised`, `agent_escalation.decided` | 5 test files, 99%+ coverage | `docs/audit/AGENT_GOVERNANCE_LAYER.md` |

## Chaining gaps (why no workflow reaches end-to-end today)

Reading left to right across the patient lifecycle diagram, each arrow
below is a real, missing connection -- not a vague aspiration:

1. **WhatsApp -> WF-003.** The webhook route persists an inbound image
   message and classifies intent as `prescription_upload`, but
   `apps/web`'s `UnwiredWorkflowInvoker` cannot invoke WF-003's step (or
   any step) -- `ConversationEngine` hands off to a human instead.
2. **WF-003 -> WF-004.** Nothing automatically triggers extraction after
   upload; `POST /api/v1/prescriptions/{id}/extract` is a separate,
   manually-invoked staff action.
3. **WF-004 -> WF-007.** `route_to_clinical_review` (WF-004's second step)
   is structural only -- extraction completing doesn't automatically
   create or advance a clinical review.
4. **WF-007 -> WF-006's `validated`/`reviewed` states.** These do connect
   for real (`decide_clinical_review` advances the MAR on approval), the
   one genuinely-chained pair in this matrix.
5. **WF-006 -> WF-008/WF-009.** `docs/audit/RC1_BACKLOG.md` item 19: MAR
   `searching`/`matched` states are unimplemented, so no MAR can reach the
   `state = 'matched'` precondition `reserve_inventory` requires. WF-008's
   inventory search is not MAR-scoped.
6. **WF-009 -> Patient Notification.** G09: zero outbound notification
   channels wired to anything (`docs/audit/LAUNCH_GAP_MATRIX.md`).
7. **-> Pharmacy Fulfillment (WF-010/011).** Fully structural, no code.
8. **-> Reporting.** No workflow or route produces a report; the
   `packages/reporting` package exists but is not evaluated in this pass.

Audit is the one cross-cutting stage that genuinely works throughout:
every atomic RPC this session touched commits business state and
`governance_audit_events`/`runtime_outbox_events` evidence in the same
transaction (verified by `packages/runtime/src/migration.test.ts`'s
`record_runtime_evidence(` occurrence-count assertions on every relevant
migration).
