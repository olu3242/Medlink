# Wave 2.1 Runtime Integration Audit

## Decision

All persona experiences must call a versioned API operation executed through `runApi`. That boundary authenticates the user, resolves active tenant membership, authorizes a typed permission, propagates correlation/request/workflow/conversation identifiers, records runtime evidence, and emits tracing, metrics, and audit data. UI code must not import Supabase clients or write domain tables directly.

The executable inventory is maintained in `@medlink/api` as `runtimeServiceContracts` and `experienceOperationContracts`. A contract is marked `available` only when a route and persistence path exist, `partial` when the domain capability exists but the portal adapter bypasses or incompletely exposes it, and `missing` when no versioned operation exists.

## Service inventory

| Capability | Package / boundary | Primary contracts | Persistence / RPC | State |
| --- | --- | --- | --- | --- |
| Runtime pipeline | `@medlink/runtime`, `@medlink/api` | `RuntimeOperation`, `RuntimeContext`, `runApi` | `record_runtime_evidence`, `runtime_outbox_events` | Available |
| Workflow runtime/store | `@medlink/workflows` | `WorkflowService`, `WorkflowStore`, `OutboxDispatcher` | `workflow_instances`, outbox | Available |
| Runtime evidence/certification | `@medlink/runtime` | `EvidenceRepository`, `EvidenceStore`, certification engine | `runtime_evidence_records` | Available |
| Search / medicine intelligence | `@medlink/search`, `@medlink/medicine` | `MedicineSearchService`, `SearchPage`, equivalency services | `search_medicines` RPC | Available |
| Inventory | `@medlink/inventory` | `InventoryService`, repository/lock ports | `inventory_batches` | Available |
| Clinical review | `@medlink/clinical` | validation, findings, acknowledgement | `clinical_reviews`, `mar_audit_events` | Available; portal integration partial |
| Reservations / fulfillment | `@medlink/reservations`, `@medlink/workflows` | reservation service, `FulfillmentCoordinator` | `reserve_inventory` RPC, `reservations` | Available |
| Conversation / WhatsApp | `@medlink/conversation`, `@medlink/whatsapp` | session/message store, journey adapter | conversation tables | Domain available; persona API missing |
| Notifications | `@medlink/notifications` | idempotent service/channel/store | `notification_outbox` | Available; must be outbox-driven |
| AI gateway/governance | `@medlink/ai` | `AgentOrchestrator`, confidence policy, audit sink | agent audit data | Partial; no named-agent UI contract |
| Authentication/RBAC | `@medlink/platform`, `runApi` | `Role`, `Permission`, `authorize` | `organization_memberships` | Available |
| Observability | `@medlink/observability`, runtime tracing | logger, metrics, tracing, diagnostics | runtime diagnostics/evidence | Available |

## API and portal findings

- Patient has versioned MAR, inventory, pharmacy, reservation, and review routes. MAR and reservation flows are the strongest starting points for Wave 2.2.
- Patient `AccessApplication` currently performs direct table/RPC access behind API routes. This is acceptable only as an application adapter; page components must consume the routes, and application methods must progressively delegate to domain package ports rather than reimplement rules.
- Pharmacy, pharmacist, dashboard, developer, and provider portals primarily use app-local `lib/api.ts` adapters. Their expected professional operations are declared in `@medlink/api`, but several matching route handlers are not yet present in those apps.
- `professionalOperations` describes inventory, reservation, review, and provider contracts but does not itself implement them.
- Notification delivery is idempotent, but the experience layer lacks a workflow-event-to-notification consumer registry.
- Conversation state is WhatsApp-only by contract and supports workflow linkage and human handoff. There is no persona conversation-center API yet.
- The current AI orchestrator enforces confidence thresholds, audit, mandatory human review, and prohibits MAR transitions/clinical decisions. It does not yet expose Prompt Registry or named Alice/Atlas/Clara contracts; those remain Batch 3 gaps.

## Existing event contracts

The current versioned events cover conversation acceptance/handoff, MAR transitions, inventory locks, reservation lifecycle, and payment authorization. New UI integration must reuse these names and versions. Events required for prescription upload/OCR completion, notification scheduling/delivery, referral lifecycle, and delivery tracking must be added through the existing event registry and outbox—not emitted ad hoc from UI code.

## Integration sequence

1. Patient MAR list/detail/create and reservation flows through existing API routes.
2. Add workflow timeline read model sourced from MAR audit/runtime evidence.
3. Add conversation read operation and outbox notification consumers for Wave 2.2.
4. Implement declared professional routes for pharmacy and pharmacist using domain ports for Wave 2.3.
5. Implement provider prescription/referral operations and interoperability adapters for Wave 2.4.
6. Certify every operation for correlation, evidence, RBAC, tenant isolation, audit, observability, accessibility, and failure recovery in Wave 2.5.

## Prohibited integration patterns

- Supabase calls from React components.
- UI-owned state-transition rules.
- Notification sends performed directly by page actions.
- AI output that transitions an MAR or finalizes a clinical decision.
- New gateway, memory, orchestration, audit, or evidence systems parallel to the existing packages.
- “Available” status without a versioned route, permission, tenant enforcement, evidence, and a tested persistence adapter.
