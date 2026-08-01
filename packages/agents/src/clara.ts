import type { AIGateway, PromptDefinition } from "@medlink/ai";
import type { ValidationFinding } from "@medlink/clinical";
import type { EquivalencyCandidate } from "@medlink/medicine";
import type { RuntimeContext } from "@medlink/runtime";
import { detectsClinicalDecisionLanguage } from "./alice-guardrail";
import { authorizeAgentCapability } from "./policy";
import { AgentCapabilityDeniedError } from "./agent-runtime";

// AG-04 -- Clara, the Clinical Copilot. Unlike Alice (patient-facing, must
// refuse clinical questions) and Atlas (catalog-first, LLM only as a
// fallback), Clara's whole job is to narrate real clinical content for a
// pharmacist who is *already* the human in the loop -- so there is no
// patient-bypass risk to escalate away from, and every capability is
// squarely, deliberately advisory: Clara never computes a clinical
// judgment of her own. She narrates data that already exists and was
// already computed by governed, tested code elsewhere in this
// repository:
//
//   - summarize_prescription's `findings` input is the real
//     ValidationFinding[] packages/clinical's ClinicalValidationService
//     already produces (DuplicateTherapyRule, PatientAllergyRule,
//     PolypharmacyRiskRule) -- Clara restates them in plain language, she
//     does not re-run or reinterpret the clinical rules themselves.
//   - explain_equivalence_candidates' `candidates` input is the real
//     EquivalencyCandidate[] packages/medicine's CatalogEquivalencyService
//     already computed (exact ingredient/strength/form/route matching,
//     always `decision: "pharmacist_review_required"`,
//     `mayAutoSubstitute: false`) -- Clara explains what a candidate means
//     in plain language, she never adds, removes, or re-ranks a
//     candidate.
//
// Every generated response is checked with the same
// detectsClinicalDecisionLanguage heuristic alice-guardrail.ts already
// uses for Alice -- here it is not an escalation trigger (there is no one
// further up the chain to escalate to; the pharmacist reading this output
// already is that person), but an honest `advisoryLanguageFlag` on the
// result: a signal that the generated phrasing itself reads as a
// directive ("you should...") rather than advisory ("consider...") and
// should be reworded or read with that in mind before being relied on.

export type ClaraCapability =
  | "summarize_prescription"
  | "explain_equivalence_candidates"
  | "draft_clarification_request";

export interface ClaraSummarizePrescriptionRequest {
  readonly capability: "summarize_prescription";
  readonly prescriptionText: string;
  readonly findings: readonly ValidationFinding[];
}

export interface ClaraExplainEquivalenceCandidatesRequest {
  readonly capability: "explain_equivalence_candidates";
  readonly candidates: readonly EquivalencyCandidate[];
}

export interface ClaraDraftClarificationRequestRequest {
  readonly capability: "draft_clarification_request";
  readonly prescriptionSummary: string;
  readonly missingInformation: string;
}

export type ClaraRequest =
  | ClaraSummarizePrescriptionRequest
  | ClaraExplainEquivalenceCandidatesRequest
  | ClaraDraftClarificationRequestRequest;

export interface ClaraPrescriptionSummary {
  readonly summary: string;
  readonly flaggedFindings: readonly string[];
  readonly advisoryLanguageFlag: boolean;
}

export interface ClaraEquivalenceExplanation {
  readonly medicineId: string;
  readonly brandName: string;
  readonly eligible: boolean;
  readonly explanation: string;
}

export interface ClaraEquivalenceExplanationResult {
  readonly explanations: readonly ClaraEquivalenceExplanation[];
  readonly advisoryLanguageFlag: boolean;
}

export interface ClaraClarificationDraft {
  readonly draftMessage: string;
  readonly advisoryLanguageFlag: boolean;
}

export type ClaraResponse =
  | { readonly capability: "summarize_prescription"; readonly result: ClaraPrescriptionSummary }
  | { readonly capability: "explain_equivalence_candidates"; readonly result: ClaraEquivalenceExplanationResult }
  | { readonly capability: "draft_clarification_request"; readonly result: ClaraClarificationDraft };

const SUMMARIZE_PRESCRIPTION_PROMPT_ID = "clara_summarize_prescription";
const EXPLAIN_EQUIVALENCE_PROMPT_ID = "clara_explain_equivalence_candidate";
const DRAFT_CLARIFICATION_PROMPT_ID = "clara_draft_clarification_request";

const ADVISORY_BOUNDARY_INSTRUCTION =
  "You are Clara, MedLink's clinical copilot for pharmacists. You assist a "
  + "licensed pharmacist's own review -- you never decide, prescribe, "
  + "approve, or instruct. Use advisory language only (\"consider\", "
  + "\"the pharmacist may want to\") and never directive language "
  + "(\"you should\", \"administer\", \"prescribe\", \"take\"). The "
  + "pharmacist makes every clinical decision; you only help them see the "
  + "relevant information clearly.";

export const claraPromptDefinitions: readonly PromptDefinition[] = [
  {
    id: SUMMARIZE_PRESCRIPTION_PROMPT_ID,
    version: "0.1.0",
    owner: "clinical-ai-team",
    purpose: "Summarize a prescription's text and its already-computed clinical findings in plain language for a pharmacist's review.",
    allowedRoles: ["pharmacist", "pharmacy_staff"],
    requiredInputs: ["prescriptionText", "findings"],
    template: `${ADVISORY_BOUNDARY_INSTRUCTION}\n\nSummarize this prescription for a pharmacist about to review it. Prescription text: {{prescriptionText}}\n\nAlready-flagged clinical findings (do not add new ones, only restate these clearly): {{findings}}`,
  },
  {
    id: EXPLAIN_EQUIVALENCE_PROMPT_ID,
    version: "0.1.0",
    owner: "clinical-ai-team",
    purpose: "Explain, in plain language, what one already-computed equivalency candidate means -- never adds, removes, or ranks candidates.",
    allowedRoles: ["pharmacist", "pharmacy_staff"],
    requiredInputs: ["candidateSummary"],
    template: `${ADVISORY_BOUNDARY_INSTRUCTION}\n\nExplain what this already-computed equivalency candidate means for the pharmacist's review, in one or two plain-language sentences. Do not state whether it should be used -- that decision belongs to the pharmacist. Candidate: {{candidateSummary}}`,
  },
  {
    id: DRAFT_CLARIFICATION_PROMPT_ID,
    version: "0.1.0",
    owner: "clinical-ai-team",
    purpose: "Draft a clarification question for the pharmacist to send when information is missing. Drafting only -- no delivery mechanism exists (G09).",
    allowedRoles: ["pharmacist", "pharmacy_staff"],
    requiredInputs: ["prescriptionSummary", "missingInformation"],
    template: `${ADVISORY_BOUNDARY_INSTRUCTION}\n\nDraft a brief, clear clarification question the pharmacist could send about this prescription. Prescription summary: {{prescriptionSummary}}. Missing information: {{missingInformation}}`,
  },
];

function formatFindings(findings: readonly ValidationFinding[]): string {
  if (findings.length === 0) return "none";
  return findings.map((finding) => `[${finding.severity}] ${finding.summary} (source: ${finding.source})`).join("; ");
}

function formatCandidate(candidate: EquivalencyCandidate): string {
  return `${candidate.medicine.brandName} -- reason: ${candidate.reason}, eligible: ${candidate.eligible}`;
}

export class ClaraAgent {
  constructor(private readonly gateway: AIGateway) {}

  async respond(context: RuntimeContext, request: ClaraRequest): Promise<ClaraResponse> {
    const authorization = authorizeAgentCapability(context, "clara", request.capability);
    if (!authorization.allowed) {
      throw new AgentCapabilityDeniedError("clara", request.capability, authorization.reason!);
    }

    if (request.capability === "summarize_prescription") {
      return { capability: request.capability, result: await this.summarizePrescription(context, request) };
    }
    if (request.capability === "explain_equivalence_candidates") {
      return { capability: request.capability, result: await this.explainEquivalenceCandidates(context, request) };
    }
    return { capability: request.capability, result: await this.draftClarificationRequest(context, request) };
  }

  private async summarizePrescription(
    context: RuntimeContext,
    request: ClaraSummarizePrescriptionRequest,
  ): Promise<ClaraPrescriptionSummary> {
    const invocation = await this.gateway.invoke(context, {
      promptId: SUMMARIZE_PRESCRIPTION_PROMPT_ID,
      inputs: { prescriptionText: request.prescriptionText, findings: formatFindings(request.findings) },
    });
    return {
      summary: invocation.result.text,
      flaggedFindings: request.findings.map((finding) => finding.summary),
      advisoryLanguageFlag: detectsClinicalDecisionLanguage(invocation.result.text),
    };
  }

  private async explainEquivalenceCandidates(
    context: RuntimeContext,
    request: ClaraExplainEquivalenceCandidatesRequest,
  ): Promise<ClaraEquivalenceExplanationResult> {
    const explanations: ClaraEquivalenceExplanation[] = [];
    let advisoryLanguageFlag = false;
    for (const candidate of request.candidates) {
      const invocation = await this.gateway.invoke(context, {
        promptId: EXPLAIN_EQUIVALENCE_PROMPT_ID,
        inputs: { candidateSummary: formatCandidate(candidate) },
      });
      if (detectsClinicalDecisionLanguage(invocation.result.text)) advisoryLanguageFlag = true;
      explanations.push({
        medicineId: candidate.medicine.id,
        brandName: candidate.medicine.brandName,
        eligible: candidate.eligible,
        explanation: invocation.result.text,
      });
    }
    return { explanations, advisoryLanguageFlag };
  }

  private async draftClarificationRequest(
    context: RuntimeContext,
    request: ClaraDraftClarificationRequestRequest,
  ): Promise<ClaraClarificationDraft> {
    const invocation = await this.gateway.invoke(context, {
      promptId: DRAFT_CLARIFICATION_PROMPT_ID,
      inputs: { prescriptionSummary: request.prescriptionSummary, missingInformation: request.missingInformation },
    });
    return {
      draftMessage: invocation.result.text,
      advisoryLanguageFlag: detectsClinicalDecisionLanguage(invocation.result.text),
    };
  }
}
