import type { AIGateway, PromptDefinition } from "@medlink/ai";
import type { RuntimeContext } from "@medlink/runtime";
import { invokeGovernedCapability } from "./agent-runtime";

// AGSDK-14 -- Atlas skeleton. Per the originating superprompt's own
// instruction: "Only implement Initialization, SDK Integration,
// Capability Registration. No medicine intelligence yet. The objective is
// SDK validation." This is real wiring (a real registry entry, a real
// prompt, a real AI Gateway call through the same shared lifecycle helper
// Alice uses) proving the Agent SDK generalizes to a second agent -- it is
// NOT a certified medicine-normalization capability, and the prompt below
// says so explicitly rather than pretending to be more than it is.

export type AtlasCapability = "normalize_medicine_name";

export interface AtlasRequest {
  readonly capability: "normalize_medicine_name";
  readonly medicineName: string;
}

export interface AtlasAnswer {
  readonly kind: "answer";
  readonly text: string;
  readonly promptVersionUsed: string;
  readonly providerId: string;
}

const ATLAS_NORMALIZE_MEDICINE_NAME_PROMPT_ID = "atlas_normalize_medicine_name";

export const atlasPromptDefinitions: readonly PromptDefinition[] = [
  {
    id: ATLAS_NORMALIZE_MEDICINE_NAME_PROMPT_ID,
    version: "0.1.0",
    owner: "medicine-intelligence-team",
    purpose: "AGSDK-14 skeleton placeholder -- proves Agent SDK wiring, not a certified medicine-normalization result.",
    allowedRoles: ["patient", "pharmacist", "pharmacy_staff"],
    requiredInputs: ["medicineName"],
    template: "This is a placeholder prompt that proves Agent SDK wiring only -- it is not real medicine normalization. Echo the input back verbatim: {{medicineName}}",
  },
];

export class AtlasAgent {
  constructor(private readonly gateway: AIGateway) {}

  async respond(context: RuntimeContext, request: AtlasRequest): Promise<AtlasAnswer> {
    // No guardrails are configured: Atlas has no clinical-decision surface
    // to guard against at the skeleton stage, and per the original AI
    // Platform spec "Atlas never approves substitutions" -- there is
    // nothing here yet requiring escalation semantics.
    const result = await invokeGovernedCapability(
      context,
      this.gateway,
      "atlas",
      request.capability,
      { promptId: ATLAS_NORMALIZE_MEDICINE_NAME_PROMPT_ID, inputs: { medicineName: request.medicineName } },
    );
    if (result.outcome !== "answer") {
      throw new Error(`Unexpected non-answer outcome from Atlas (no guardrails are configured): ${result.outcome}`);
    }
    return {
      kind: "answer",
      text: result.text,
      promptVersionUsed: result.promptVersionUsed,
      providerId: result.providerId,
    };
  }
}
