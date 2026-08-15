import type { Permission, Role } from "@medlink/platform";

export type IntegrationStatus = "available" | "partial" | "missing";
export type ExperiencePersona = "patient" | "pharmacy" | "pharmacist" | "provider" | "operations";

export interface RuntimeServiceContract {
  readonly id: string;
  readonly packageName: string;
  readonly status: IntegrationStatus;
  readonly contracts: readonly string[];
  readonly persistence: readonly string[];
}

export const runtimeServiceContracts: readonly RuntimeServiceContract[] = [
  { id: "runtime", packageName: "@medlink/runtime", status: "available", contracts: ["RuntimeOperation", "RuntimeContext", "RuntimeEvents", "RuntimeAudit", "RuntimeTelemetry"], persistence: ["record_runtime_evidence", "runtime_evidence_records", "runtime_outbox_events"] },
  { id: "workflow", packageName: "@medlink/workflows", status: "available", contracts: ["WorkflowService", "WorkflowStore", "OutboxDispatcher", "FulfillmentCoordinator"], persistence: ["workflow_instances", "runtime_outbox_events"] },
  { id: "search", packageName: "@medlink/search", status: "available", contracts: ["MedicineSearchService", "MedicineSearchQuery", "SearchPage"], persistence: ["search_medicines"] },
  { id: "inventory", packageName: "@medlink/inventory", status: "available", contracts: ["InventoryService", "InventoryRepository", "InventoryItem"], persistence: ["inventory_batches"] },
  { id: "clinical", packageName: "@medlink/clinical", status: "available", contracts: ["ClinicalValidationService", "ClinicalValidationResult", "ClinicalAcknowledgementService"], persistence: ["clinical_reviews", "mar_audit_events"] },
  { id: "reservations", packageName: "@medlink/reservations", status: "available", contracts: ["ReservationService", "ReservationRepository", "Reservation"], persistence: ["reserve_inventory", "reservations"] },
  { id: "conversation", packageName: "@medlink/conversation", status: "available", contracts: ["ConversationService", "ConversationSession", "ConversationMessage"], persistence: ["conversation_sessions", "conversation_messages"] },
  { id: "notifications", packageName: "@medlink/notifications", status: "available", contracts: ["NotificationService", "NotificationChannel", "NotificationStore"], persistence: ["notification_outbox"] },
  { id: "ai", packageName: "@medlink/ai", status: "partial", contracts: ["AgentOrchestrator", "AgentRequest", "AgentOutput", "ConfidencePolicy"], persistence: ["agent_audit_events"] },
  { id: "authorization", packageName: "@medlink/platform", status: "available", contracts: ["authorize", "can", "Permission", "Role"], persistence: ["organization_memberships"] },
  { id: "observability", packageName: "@medlink/observability", status: "available", contracts: ["runtimeLogger", "runtimeMetrics", "runtimeTracing"], persistence: ["runtime_diagnostics", "runtime_evidence_records"] },
] as const;

export interface ExperienceOperationContract {
  readonly id: string;
  readonly persona: ExperiencePersona;
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly permission: Permission;
  readonly roles: readonly Role[];
  readonly workflow: string;
  readonly services: readonly string[];
  readonly events: readonly string[];
  readonly status: IntegrationStatus;
}

export const experienceOperationContracts: readonly ExperienceOperationContract[] = [
  { id: "patient.mar.list", persona: "patient", method: "GET", path: "/api/v1/mar", permission: "mar:read", roles: ["patient"], workflow: "WF-006", services: ["runtime", "workflow"], events: [], status: "available" },
  { id: "patient.mar.get", persona: "patient", method: "GET", path: "/api/v1/mar/:id", permission: "mar:read", roles: ["patient"], workflow: "WF-006", services: ["runtime", "workflow"], events: [], status: "available" },
  { id: "patient.mar.timeline", persona: "patient", method: "GET", path: "/api/v1/mar/:id/timeline", permission: "mar:read", roles: ["patient"], workflow: "WF-006", services: ["runtime", "workflow"], events: [], status: "available" },
  { id: "patient.mar.create", persona: "patient", method: "POST", path: "/api/v1/mar", permission: "mar:create", roles: ["patient"], workflow: "WF-006", services: ["runtime", "workflow"], events: ["mar.transitioned.v1"], status: "available" },
  { id: "patient.inventory.search", persona: "patient", method: "GET", path: "/api/v1/inventory", permission: "inventory:read", roles: ["patient"], workflow: "WF-008", services: ["runtime", "search", "inventory"], events: [], status: "partial" },
  { id: "patient.reservation.create", persona: "patient", method: "POST", path: "/api/v1/reservations", permission: "reservation:create", roles: ["patient"], workflow: "WF-009", services: ["runtime", "reservations", "workflow"], events: ["inventory.locked.v1", "reservation.created.v1"], status: "available" },
  { id: "patient.reservation.list", persona: "patient", method: "GET", path: "/api/v1/reservations", permission: "reservation:read", roles: ["patient"], workflow: "WF-009", services: ["runtime", "reservations"], events: [], status: "available" },
  { id: "patient.reservation.credential", persona: "patient", method: "POST", path: "/api/v1/reservations/:id/credential", permission: "reservation:credential", roles: ["patient"], workflow: "WF-009", services: ["runtime", "reservations"], events: ["reservation.credential_issued.v1"], status: "available" },
  { id: "patient.pharmacy.list", persona: "patient", method: "GET", path: "/api/v1/pharmacies", permission: "inventory:read", roles: ["patient"], workflow: "WF-008", services: ["runtime", "inventory"], events: [], status: "available" },
  { id: "patient.notification.list", persona: "patient", method: "GET", path: "/api/v1/notifications", permission: "mar:read", roles: ["patient"], workflow: "WF-012", services: ["runtime", "notifications", "workflow"], events: [], status: "available" },
  { id: "pharmacy.inventory.list", persona: "pharmacy", method: "GET", path: "/api/v1/inventory", permission: "inventory:read", roles: ["pharmacy_staff", "pharmacy_owner"], workflow: "WF-008", services: ["runtime", "inventory"], events: [], status: "partial" },
  { id: "pharmacy.reservation.list", persona: "pharmacy", method: "GET", path: "/api/v1/reservations", permission: "reservation:read", roles: ["pharmacy_staff", "pharmacy_owner"], workflow: "WF-009", services: ["runtime", "reservations"], events: [], status: "partial" },
  { id: "pharmacist.review.list", persona: "pharmacist", method: "GET", path: "/api/v1/review", permission: "clinical:review", roles: ["pharmacist"], workflow: "WF-007", services: ["runtime", "clinical"], events: [], status: "partial" },
  { id: "pharmacist.review.get", persona: "pharmacist", method: "GET", path: "/api/v1/review/:id", permission: "clinical:review", roles: ["pharmacist"], workflow: "WF-007", services: ["runtime", "clinical"], events: [], status: "partial" },
  { id: "pharmacist.review.decide", persona: "pharmacist", method: "PATCH", path: "/api/v1/review/:id", permission: "clinical:review", roles: ["pharmacist"], workflow: "WF-007", services: ["runtime", "clinical", "workflow"], events: ["mar.transitioned.v1"], status: "partial" },
  { id: "provider.prescription.create", persona: "provider", method: "POST", path: "/api/v1/provider/prescriptions", permission: "prescription:create", roles: ["provider"], workflow: "WF-003", services: ["runtime", "workflow"], events: [], status: "partial" },
  { id: "communication.conversation", persona: "operations", method: "GET", path: "/api/v1/conversations", permission: "mar:read", roles: ["patient", "pharmacist", "pharmacy_staff", "provider"], workflow: "WF-012", services: ["runtime", "conversation", "notifications"], events: ["conversation.message.accepted.v1"], status: "missing" },
] as const;

export function integrationContract(id: string): ExperienceOperationContract | undefined {
  return experienceOperationContracts.find((contract) => contract.id === id);
}
