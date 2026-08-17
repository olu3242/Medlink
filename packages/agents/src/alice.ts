import type { AIGateway, PromptDefinition } from "@medlink/ai";
import type { RuntimeContext } from "@medlink/runtime";
import { detectsClinicalAdviceRequest, detectsClinicalDecisionLanguage } from "./alice-guardrail";
import { authorizeAgentCapability, type AgentAuthorizationDenialReason } from "./policy";
import type { EscalationStore } from "./supervision";

// ENGINE AG-02 -- Alice, the Patient Experience Agent. The first real
// consumer of the AI Gateway and Prompt Registry (packages/ai):
// "AI Phase 1" built the infrastructure with zero consumers by design;
// this is the first one. Alice guides patients through the platform --
// she never diagnoses, prescribes, interprets a prescription clinically,
// or overrides a pharmacist. Every capability she has is read-only,
// non-clinical, and, per the governed catalog entry this module also
// declares, requires no human pre-approval to execute -- the safety
// control here is not "block until approved" (that pattern exists
// elsewhere in this catalog for genuinely clinical capabilities) but
// "detect and escalate instead of answering" when a question or a
// response crosses into clinical territory.
export const aliceCapabilities = [
  "answer_platform_question",
  "guide_prescription_upload",
  "explain_workflow_status",
  "collect_administrative_information",
] as const;
export type AliceCapability = (typeof aliceCapabilities)[number];

export type AliceRequest =
  | { readonly capability: "answer_platform_question"; readonly question: string }
  | { readonly capability: "guide_prescription_upload"; readonly question: string }
  | { readonly capability: "explain_workflow_status"; readonly question: string; readonly workflowStatus: string }
  | { readonly capability: "collect_administrative_information"; readonly question: string };

export interface AliceAnswer {
  readonly kind: "answer";
  readonly text: string;
  readonly promptVersionUsed: string;
  readonly providerId: string;
}

export interface AliceEscalation {
  readonly kind: "escalated";
  readonly escalationId: string;
  readonly reason: "patient_question_requires_clinical_judgment" | "response_required_clinical_judgment";
}

export type AliceResponse = AliceAnswer | AliceEscalation;

export class AliceCapabilityDeniedError extends Error {
  constructor(readonly capability: AliceCapability, readonly reason: AgentAuthorizationDenialReason) {
    super(`Alice denied capability "${capability}" (${reason})`);
    this.name = "AliceCapabilityDeniedError";
  }
}

const PROMPT_ID_BY_CAPABILITY: Readonly<Record<AliceCapability, string>> = {
  answer_platform_question: "alice_answer_platform_question",
  guide_prescription_upload: "alice_guide_prescription_upload",
  explain_workflow_status: "alice_explain_workflow_status",
  collect_administrative_information: "alice_collect_administrative_information",
};

const SAFETY_BOUNDARY_INSTRUCTION =
  "You are Alice, MedLink's patient experience assistant. You help with the "
  + "platform, not with clinical decisions. Never diagnose a condition, never "
  + "recommend a medicine or dosage, never interpret a prescription "
  + "clinically, and never override a pharmacist's judgment. If the "
  + "question requires clinical judgment, say plainly that you cannot "
  + "answer it and that a member of the pharmacist team will follow up.";

// Every prompt embeds the same safety-boundary instruction verbatim --
// deliberately duplicated per prompt rather than composed at render time,
// so each prompt's registered text is exactly what is sent to the model
// and exactly what a reviewer auditing the Prompt Registry sees, with
// nothing assembled invisibly outside it.
export const alicePromptDefinitions: readonly PromptDefinition[] = [
  {
    id: "alice_answer_platform_question",
    version: "1.0.0",
    owner: "patient-experience-team",
    purpose: "Answer a patient's general question about how the MedLink platform works.",
    allowedRoles: ["patient"],
    requiredInputs: ["question"],
    template: `${SAFETY_BOUNDARY_INSTRUCTION}\n\nPatient question: {{question}}`,
  },
  {
    id: "alice_guide_prescription_upload",
    version: "1.0.0",
    owner: "patient-experience-team",
    purpose: "Guide a patient through uploading a prescription image or document.",
    allowedRoles: ["patient"],
    requiredInputs: ["question"],
    template: `${SAFETY_BOUNDARY_INSTRUCTION}\n\nExplain, in plain language, how to upload a prescription photo or document on MedLink. Patient question: {{question}}`,
  },
  {
    id: "alice_explain_workflow_status",
    version: "1.0.0",
    owner: "patient-experience-team",
    purpose: "Explain a patient's current prescription workflow status in plain language.",
    allowedRoles: ["patient"],
    requiredInputs: ["status", "question"],
    template: `${SAFETY_BOUNDARY_INSTRUCTION}\n\nThe patient's current prescription status is: {{status}}. Explain what this means in plain language, then answer: {{question}}`,
  },
  {
    id: "alice_collect_administrative_information",
    version: "1.0.0",
    owner: "patient-experience-team",
    purpose: "Ask a clarifying, non-clinical administrative question (e.g. delivery address, contact details).",
    allowedRoles: ["patient"],
    requiredInputs: ["question"],
    template: `${SAFETY_BOUNDARY_INSTRUCTION}\n\nThe patient said: {{question}}. If administrative information (such as address or contact details) is missing and needed to proceed, ask for it clearly. Never ask for clinical information.`,
  },
];

export class AliceAgent {
  constructor(
    private readonly gateway: AIGateway,
    private readonly escalations: EscalationStore,
  ) {}

  async respond(context: RuntimeContext, request: AliceRequest): Promise<AliceResponse> {
    const authorization = authorizeAgentCapability(context, "alice", request.capability);
    if (!authorization.allowed) {
      throw new AliceCapabilityDeniedError(request.capability, authorization.reason!);
    }

    if (detectsClinicalAdviceRequest(request.question)) {
      return this.escalate(context, request, "patient_question_requires_clinical_judgment");
    }

    const inputs: Record<string, string> =
      request.capability === "explain_workflow_status"
        ? { question: request.question, status: request.workflowStatus }
        : { question: request.question };

    const invocation = await this.gateway.invoke(context, {
      promptId: PROMPT_ID_BY_CAPABILITY[request.capability],
      inputs,
    });

    if (detectsClinicalDecisionLanguage(invocation.result.text)) {
      return this.escalate(context, request, "response_required_clinical_judgment");
    }

    return {
      kind: "answer",
      text: invocation.result.text,
      promptVersionUsed: invocation.promptVersionUsed,
      providerId: invocation.providerId,
    };
  }

  private async escalate(
    context: RuntimeContext,
    request: AliceRequest,
    reason: AliceEscalation["reason"],
  ): Promise<AliceEscalation> {
    const escalation = await this.escalations.raise({
      organizationId: context.organizationId,
      agentId: "alice",
      capabilityName: request.capability,
      workflowType: "alice_conversation",
      subjectId: context.userId,
      idempotencyKey: `alice:${context.correlationId}`,
      payload: { reason },
    });
    return { kind: "escalated", escalationId: escalation.id, reason };
  }
}
