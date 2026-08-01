// Named agents that never mutate state carry `invokes: undefined`; the
// closed union below is what keeps every mutating capability pointed at a
// real, already-transactional/idempotent/audited RPC instead of a raw table
// name -- an agent capability literally cannot type-check against something
// that isn't on this list.
export const canonicalOperations = [
  "create_medicine_record",
  "update_medicine_record",
  "create_prescription_record",
  "record_prescription_extraction",
  "record_clinical_validation",
  "create_mar",
  "reserve_inventory",
  "search_catalog",
  "search_inventory",
] as const;
export type CanonicalOperation = (typeof canonicalOperations)[number];

// Decision RPCs a licensed human alone may invoke. No agent capability may
// ever declare one of these as its `invokes` target -- see
// validateGovernedAgentCatalog's humanExclusiveOperations check below, which
// is what actually enforces "pharmacist authority remains mandatory for
// clinical substitution/alternative approval" against the real catalog.
export const humanExclusiveOperations = [
  "review_medicine_equivalence",
  "decide_clinical_review",
] as const;
export type HumanExclusiveOperation = (typeof humanExclusiveOperations)[number];

export type AgentMemoryBoundary = "none" | "session" | "tenant-durable";

export interface AgentCapability {
  readonly name: string;
  readonly description: string;
  readonly mutatesState: boolean;
  readonly invokes?: CanonicalOperation;
  readonly allowedRoles: readonly string[];
  readonly requiresHumanApproval: boolean;
  readonly clinicalDecision: boolean;
}

export interface AgentIdentity {
  readonly id: string;
  readonly name: string;
  readonly mission: string;
  readonly memoryBoundary: AgentMemoryBoundary;
  readonly status: "active" | "retired";
  readonly capabilities: readonly AgentCapability[];
}

// The governed agent catalog IMPLEMENTATION.md's "AI agent catalog and
// safety" section describes in prose. Each capability here is grounded in an
// RPC or read path that already exists on main -- this registry declares
// which of those an agent may reach and under what role/approval gate, it
// does not invent new execution surface.
export const governedAgentCatalog: readonly AgentIdentity[] = [
  {
    id: "conversation",
    name: "Conversation Agent",
    mission: "Classify inbound channel messages into a canonical workflow intent.",
    memoryBoundary: "session",
    status: "active",
    capabilities: [
      {
        name: "route_intent",
        description: "Classify a message and select a canonical workflow to invoke.",
        mutatesState: false,
        allowedRoles: ["patient", "pharmacist", "pharmacy_staff"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "ocr",
    name: "OCR Agent",
    mission: "Extract structured fields from an uploaded prescription image.",
    memoryBoundary: "none",
    status: "active",
    capabilities: [
      {
        name: "extract_prescription",
        description: "Record extracted prescription fields for pharmacist review.",
        mutatesState: true,
        invokes: "record_prescription_extraction",
        allowedRoles: ["patient", "pharmacist", "pharmacy_staff"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "medicine-match",
    name: "Medicine Match Agent",
    mission: "Search the medicine catalog and record candidate matches.",
    memoryBoundary: "session",
    status: "active",
    capabilities: [
      {
        name: "search_medicine",
        description: "Search brand/generic medicines by name.",
        mutatesState: false,
        allowedRoles: ["patient", "pharmacist", "pharmacy_staff"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "inventory",
    name: "Inventory Agent",
    mission: "Search pharmacy inventory for a matched medicine.",
    memoryBoundary: "session",
    status: "active",
    capabilities: [
      {
        name: "search_inventory",
        description: "Search reservable inventory near the patient.",
        mutatesState: true,
        invokes: "search_inventory",
        allowedRoles: ["patient", "pharmacist", "pharmacy_staff"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "clinical-review-assistant",
    name: "Clinical Review Assistant",
    mission: "Surface duplicate-therapy, allergy, and polypharmacy findings for pharmacist acknowledgement. Never decides the review itself.",
    memoryBoundary: "tenant-durable",
    status: "active",
    capabilities: [
      {
        name: "flag_validation_findings",
        description: "Record advisory clinical findings; a pharmacist must acknowledge any hard-stop before the review can proceed.",
        mutatesState: true,
        invokes: "record_clinical_validation",
        allowedRoles: ["pharmacist"],
        requiresHumanApproval: true,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "reservation-coordinator",
    name: "Reservation Coordinator Agent",
    mission: "Reserve matched inventory once a MAR has been pharmacist-reviewed.",
    memoryBoundary: "session",
    status: "active",
    capabilities: [
      {
        name: "reserve_matched_inventory",
        description: "Create an inventory reservation for an already-matched MAR.",
        mutatesState: true,
        invokes: "reserve_inventory",
        allowedRoles: ["pharmacist", "pharmacy_staff"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "medication-education",
    name: "Medication Education Agent",
    mission: "Provide general medication-use information. Never dosing or substitution advice.",
    memoryBoundary: "none",
    status: "active",
    capabilities: [
      {
        name: "provide_education_content",
        description: "Return general, non-personalized medication-use information.",
        mutatesState: false,
        allowedRoles: ["patient"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "alice",
    name: "Alice, Patient Experience Agent",
    mission: "Guide patients through the MedLink platform. Never diagnose, prescribe, interpret a prescription clinically, or override a pharmacist -- a question or a response that crosses that boundary is escalated to a human, not answered.",
    memoryBoundary: "session",
    status: "active",
    capabilities: [
      {
        name: "answer_platform_question",
        description: "Answer a patient's general question about how the MedLink platform works.",
        mutatesState: false,
        allowedRoles: ["patient"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
      {
        name: "guide_prescription_upload",
        description: "Guide a patient through uploading a prescription image or document.",
        mutatesState: false,
        allowedRoles: ["patient"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
      {
        name: "explain_workflow_status",
        description: "Explain a patient's current prescription workflow status in plain language.",
        mutatesState: false,
        allowedRoles: ["patient"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
      {
        name: "collect_administrative_information",
        description: "Ask a clarifying, non-clinical administrative question.",
        mutatesState: false,
        allowedRoles: ["patient"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
  {
    id: "analytics",
    name: "Analytics Agent",
    mission: "Aggregate tenant-scoped operational metrics.",
    memoryBoundary: "none",
    status: "active",
    capabilities: [
      {
        name: "aggregate_usage_metrics",
        description: "Compute read-only operational aggregates for a tenant.",
        mutatesState: false,
        allowedRoles: ["tenant_admin", "platform_admin"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
    ],
  },
] as const;

export function findAgent(agentId: string): AgentIdentity | undefined {
  return governedAgentCatalog.find((agent) => agent.id === agentId);
}

export function findCapability(
  agentId: string,
  capabilityName: string,
): AgentCapability | undefined {
  return findAgent(agentId)?.capabilities.find((capability) => capability.name === capabilityName);
}

const humanExclusiveSet: ReadonlySet<string> = new Set(humanExclusiveOperations);

// Validates the structural invariants a governed agent catalog must hold.
// Returns an empty array when the catalog is valid. Exported (not just run
// once against the real catalog) so any future catalog -- including one
// assembled dynamically by a later engine -- can be certified the same way.
export function validateGovernedAgentCatalog(
  catalog: readonly AgentIdentity[],
): readonly string[] {
  const violations: string[] = [];
  const seenAgentIds = new Set<string>();
  for (const agent of catalog) {
    if (seenAgentIds.has(agent.id)) {
      violations.push(`duplicate agent id: ${agent.id}`);
    }
    seenAgentIds.add(agent.id);

    const seenCapabilityNames = new Set<string>();
    for (const capability of agent.capabilities) {
      const identity = `${agent.id}.${capability.name}`;
      if (seenCapabilityNames.has(capability.name)) {
        violations.push(`duplicate capability name: ${identity}`);
      }
      seenCapabilityNames.add(capability.name);

      if (capability.allowedRoles.length === 0) {
        violations.push(`capability declares no allowed roles: ${identity}`);
      }
      if (capability.mutatesState && !capability.invokes) {
        violations.push(`mutating capability declares no canonical operation: ${identity}`);
      }
      if (!capability.mutatesState && capability.invokes) {
        violations.push(`read-only capability declares a canonical operation: ${identity}`);
      }
      if (capability.invokes && humanExclusiveSet.has(capability.invokes)) {
        violations.push(`capability invokes a human-exclusive operation: ${identity} -> ${capability.invokes}`);
      }
      if (capability.clinicalDecision && !capability.requiresHumanApproval) {
        violations.push(`clinical-decision capability does not require human approval: ${identity}`);
      }
    }
  }
  return violations;
}
