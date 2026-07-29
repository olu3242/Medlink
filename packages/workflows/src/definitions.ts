import type { CanonicalWorkflowId } from "./service";

export interface WorkflowDefinition {
  readonly id: CanonicalWorkflowId;
  readonly name: string;
  // Step names only -- the structural shape of the workflow (RC1_BACKLOG
  // item 16's "canonical definitions"), not necessarily an executable
  // WorkflowStep[] yet. Grounded in the DB state machines already built
  // this session (mar_status, prescription_status, extraction_status) and
  // docs/release-scope.md's Wave 3 scope list, not invented. Real
  // executable WorkflowSteps exist so far for: WF-003's
  // "store_prescription_record" (prescription-upload.ts), WF-004's
  // "run_extraction" (prescription-parsing.ts), WF-005's "search_catalog"
  // (medicine-search.ts), WF-006's "create_mar" (mar-creation.ts), WF-007's
  // "run_clinical_validation" and "pharmacist_review" (clinical-review.ts),
  // WF-008's "search_inventory" (inventory-discovery.ts), and WF-009's
  // "reserve_inventory" (reservation.ts) -- eight steps across seven of
  // fifteen workflows. definitions.test.ts guards every one of these
  // against drifting from this file. Every other step name describes
  // intent for Batch 3.2 to implement later.
  readonly steps: readonly string[];
}

export const workflowDefinitions: Readonly<Record<CanonicalWorkflowId, WorkflowDefinition>> = {
  "WF-001": {
    id: "WF-001",
    name: "Patient Registration",
    steps: ["collect_identity", "verify_channel_identity", "create_patient_profile", "link_conversation_identity"],
  },
  "WF-002": {
    id: "WF-002",
    name: "Authentication",
    steps: ["verify_channel_identity", "resolve_session"],
  },
  "WF-003": {
    id: "WF-003",
    name: "Prescription Upload",
    steps: ["receive_media", "store_prescription_record"],
  },
  "WF-004": {
    id: "WF-004",
    name: "Prescription Parsing",
    steps: ["run_extraction", "route_to_clinical_review"],
  },
  "WF-005": {
    id: "WF-005",
    name: "Medicine Search",
    steps: ["parse_query", "search_catalog", "return_matches"],
  },
  "WF-006": {
    id: "WF-006",
    name: "Medication Access Request",
    steps: ["create_mar", "validate_mar"],
  },
  "WF-007": {
    id: "WF-007",
    name: "Clinical Review",
    steps: ["run_clinical_validation", "pharmacist_review"],
  },
  "WF-008": {
    id: "WF-008",
    name: "Inventory Discovery",
    steps: ["search_inventory", "match_inventory"],
  },
  "WF-009": {
    id: "WF-009",
    name: "Reservation",
    steps: ["reserve_inventory"],
  },
  "WF-010": {
    id: "WF-010",
    name: "Pickup",
    steps: ["generate_pickup_code", "confirm_pickup"],
  },
  "WF-011": {
    id: "WF-011",
    name: "Delivery",
    steps: ["schedule_delivery", "confirm_delivery"],
  },
  "WF-012": {
    id: "WF-012",
    name: "Medication Reminder",
    steps: ["schedule_reminder", "send_reminder"],
  },
  "WF-013": {
    id: "WF-013",
    name: "Consultation",
    steps: ["request_consultation", "assign_pharmacist", "complete_consultation"],
  },
  "WF-014": {
    id: "WF-014",
    name: "Refill",
    steps: ["locate_prior_mar", "create_refill_mar"],
  },
  "WF-015": {
    id: "WF-015",
    name: "Workflow Completion",
    steps: ["finalize_mar", "emit_completion_event"],
  },
};
