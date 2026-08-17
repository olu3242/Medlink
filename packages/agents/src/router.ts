import { findCapability } from "./registry";

export const medicationAccessCapabilities = [
  "conversation.intent",
  "prescription.ocr",
  "medicine.resolve",
  "clinical.findings",
  "inventory.discover",
  "reservation.coordinate",
] as const;

export type MedicationAccessCapability =
  (typeof medicationAccessCapabilities)[number];

export interface AgentRouteRequest {
  readonly workflowType: "medication_access";
  readonly workflowState: string;
  readonly requiredCapability: MedicationAccessCapability;
  readonly persona: string;
  readonly tenantId: string;
}

export interface AgentRoute {
  readonly planVersion: "medication-access.v1";
  readonly agentId: string;
  readonly agentVersion: string;
  readonly capabilityName: string;
  readonly executionMode: "autonomous" | "human_gated";
  readonly requiresHumanApproval: boolean;
}

const routes: Readonly<Record<MedicationAccessCapability, {
  agentId: string;
  capabilityName: string;
}>> = {
  "conversation.intent": {
    agentId: "conversation",
    capabilityName: "route_intent",
  },
  "prescription.ocr": {
    agentId: "ocr",
    capabilityName: "extract_prescription",
  },
  "medicine.resolve": {
    agentId: "medicine-match",
    capabilityName: "search_medicine",
  },
  "clinical.findings": {
    agentId: "clinical-review-assistant",
    capabilityName: "flag_validation_findings",
  },
  "inventory.discover": {
    agentId: "inventory",
    capabilityName: "search_inventory",
  },
  "reservation.coordinate": {
    agentId: "reservation-coordinator",
    capabilityName: "reserve_matched_inventory",
  },
};

export class AgentRouteDeniedError extends Error {
  readonly code = "agent_route_denied";

  constructor(readonly reason: "role_not_permitted" | "capability_not_declared") {
    super("No governed agent route is permitted for this context");
    this.name = "AgentRouteDeniedError";
  }
}

export function routeAgent(input: AgentRouteRequest): AgentRoute {
  const selected = routes[input.requiredCapability];
  const capability = findCapability(selected.agentId, selected.capabilityName);
  if (!capability) throw new AgentRouteDeniedError("capability_not_declared");
  if (!capability.allowedRoles.includes(input.persona)) {
    throw new AgentRouteDeniedError("role_not_permitted");
  }
  return {
    planVersion: "medication-access.v1",
    agentId: selected.agentId,
    agentVersion: "1.0.0",
    capabilityName: selected.capabilityName,
    executionMode: capability.requiresHumanApproval ? "human_gated" : "autonomous",
    requiresHumanApproval: capability.requiresHumanApproval,
  };
}

export function medicationAccessPlan(
  tenantId: string,
  personas: Readonly<Record<MedicationAccessCapability, string>>,
): readonly AgentRoute[] {
  return medicationAccessCapabilities.map((requiredCapability, index) => routeAgent({
    workflowType: "medication_access",
    workflowState: `step_${index}`,
    requiredCapability,
    persona: personas[requiredCapability],
    tenantId,
  }));
}
