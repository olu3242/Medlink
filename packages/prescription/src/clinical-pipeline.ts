import {
  AgentTaskExecutor,
  type AgentStage,
} from "@medlink/agent-runtime";
import { routeAgent } from "@medlink/agents";
import { z } from "zod";
import {
  structuredPrescriptionSchema,
  type StructuredPrescription,
} from "./model";

const confidence = z.number().min(0).max(1);

export const ocrResultSchema = z.object({
  text: z.string().trim().min(1).max(200_000),
  pageCount: z.number().int().min(1).max(50),
  confidence,
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(160),
}).strict();

export type OcrResult = z.infer<typeof ocrResultSchema>;

export type ClinicalPipelineStage = "ocr" | "parsing" | "clinical_validation";

interface ClaimBase {
  readonly extractionId: string;
  readonly pipelineId: string;
  readonly workflowId: string;
  readonly sourceEventId: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly prescriptionId: string;
  readonly correlationId: string;
  readonly attempt: number;
  readonly workerId: string;
  readonly leaseToken: string;
}

export interface OcrClaim extends ClaimBase {
  readonly stage: "ocr";
  readonly source: {
    readonly bucket: string;
    readonly path: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  };
}

export interface ParsingClaim extends ClaimBase {
  readonly stage: "parsing";
  readonly ocr: OcrResult;
}

export interface ValidationClaim extends ClaimBase {
  readonly stage: "clinical_validation";
  readonly ocr: OcrResult;
  readonly extraction: StructuredPrescription;
}

export type ClinicalPipelineClaim = OcrClaim | ParsingClaim | ValidationClaim;

export interface OcrProvider {
  extract(input: {
    bytes: Uint8Array;
    mediaType: string;
    correlationId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface PrescriptionStructureProvider {
  parse(input: {
    text: string;
    correlationId: string;
    signal: AbortSignal;
  }): Promise<unknown>;
}

export interface PipelineSourceStore {
  download(
    bucket: string,
    path: string,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<string>;
}

export interface PipelineFinding {
  readonly code: string;
  readonly severity: "informational" | "moderate" | "critical";
  readonly title: string;
  readonly detail: string;
  readonly confidence: number;
  readonly requiresAcknowledgement: boolean;
}

export interface ClinicalPipelineRepository {
  claim(
    workerId: string,
    signal: AbortSignal,
  ): Promise<ClinicalPipelineClaim | null>;
  completeOcr(input: {
    claim: OcrClaim;
    workerId: string;
    result: OcrResult;
    signal: AbortSignal;
  }): Promise<void>;
  completeParsing(input: {
    claim: ParsingClaim;
    workerId: string;
    extraction: StructuredPrescription;
    signal: AbortSignal;
  }): Promise<void>;
  completeValidation(input: {
    claim: ValidationClaim;
    workerId: string;
    findings: readonly PipelineFinding[];
    signal: AbortSignal;
  }): Promise<void>;
  fail(input: {
    claim: ClinicalPipelineClaim;
    workerId: string;
    errorCode: string;
    retryable: boolean;
    signal: AbortSignal;
  }): Promise<"retrying" | "failed">;
}

export class ClinicalPipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClinicalPipelineError";
  }
}

export class PrescriptionQualityValidator {
  constructor(private readonly threshold = 0.85) {}

  validate(extraction: StructuredPrescription): readonly PipelineFinding[] {
    const headerFields: [string, { value: string; confidence: number }][] = [];
    if (extraction.patientName) {
      headerFields.push(["patientName", extraction.patientName]);
    }
    if (extraction.prescriberName) {
      headerFields.push(["prescriberName", extraction.prescriberName]);
    }
    const fields = [
      ...headerFields,
      ...extraction.items.flatMap((item, index) =>
      Object.entries(item)
        .filter((entry): entry is [string, { value: string; confidence: number }] =>
          typeof entry[1] === "object"
          && entry[1] !== null
          && "confidence" in entry[1],
        )
        .map(([name, value]) => [`items.${index}.${name}`, value] as const),
      ),
    ];
    const findings: PipelineFinding[] = fields
      .filter(([, field]) => field.confidence < this.threshold)
      .map(([name, field]) => ({
        code: `ambiguous_${name}`,
        severity: "moderate" as const,
        title: "Ambiguous prescription field",
        detail: `${name} requires pharmacist verification.`,
        confidence: field.confidence,
        requiresAcknowledgement: true,
      }));
    if (extraction.overallConfidence < 0.4) {
      findings.push({
        code: "prescription_illegible",
        severity: "critical",
        title: "Prescription may be illegible",
        detail: "Automated extraction confidence is too low for unassisted use.",
        confidence: extraction.overallConfidence,
        requiresAcknowledgement: true,
      });
    } else if (extraction.overallConfidence < this.threshold) {
      findings.push({
        code: "low_overall_confidence",
        severity: "moderate",
        title: "Low extraction confidence",
        detail: "The complete extraction requires pharmacist verification.",
        confidence: extraction.overallConfidence,
        requiresAcknowledgement: true,
      });
    }
    findings.push({
      code: "clinical_context_requires_pharmacist",
      severity: "moderate",
      title: "Independent clinical context review required",
      detail: "Allergy and current-medication context must be verified by a pharmacist.",
      confidence: 1,
      requiresAcknowledgement: true,
    });
    return findings;
  }
}

type StageOutput =
  | { readonly stage: "ocr"; readonly result: OcrResult }
  | { readonly stage: "parsing"; readonly extraction: StructuredPrescription }
  | {
      readonly stage: "clinical_validation";
      readonly findings: readonly PipelineFinding[];
    };

export class ClinicalPipelineWorker
implements AgentStage<string, ClinicalPipelineClaim, StageOutput> {
  readonly id = "ML-CPP-001";

  constructor(
    private readonly repository: ClinicalPipelineRepository,
    private readonly source: PipelineSourceStore,
    private readonly ocr: OcrProvider,
    private readonly parser: PrescriptionStructureProvider,
    private readonly taskExecutor: AgentTaskExecutor,
    private readonly quality = new PrescriptionQualityValidator(),
  ) {}

  initialize(workerId: string, signal: AbortSignal) {
    return this.repository.claim(workerId, signal);
  }

  async validate(claim: ClinicalPipelineClaim, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason;
    const identifiers = [
      claim.extractionId,
      claim.pipelineId,
      claim.workflowId,
      claim.tenantId,
      claim.patientId,
      claim.prescriptionId,
      claim.leaseToken,
    ];
    if (
      identifiers.some((value) => !z.string().uuid().safeParse(value).success)
      || !Number.isInteger(claim.attempt)
      || claim.attempt < 1
      || claim.attempt > 5
    ) {
      throw new ClinicalPipelineError(
        "clinical_claim_invalid",
        "The clinical processing claim is invalid",
        false,
      );
    }
    if (claim.stage === "ocr") {
      if (
        claim.source.sizeBytes < 1
        || claim.source.sizeBytes > 10 * 1024 * 1024
        || !["image/jpeg", "image/png", "application/pdf"]
          .includes(claim.source.mediaType)
        || !/^[a-f0-9]{64}$/.test(claim.source.sha256)
      ) {
        throw new ClinicalPipelineError(
          "ocr_source_invalid",
          "The OCR source does not satisfy intake policy",
          false,
        );
      }
    } else if (claim.stage === "parsing") {
      ocrResultSchema.parse(claim.ocr);
    } else {
      ocrResultSchema.parse(claim.ocr);
      structuredPrescriptionSchema.parse(claim.extraction);
    }
  }

  async execute(
    claim: ClinicalPipelineClaim,
    signal: AbortSignal,
  ): Promise<StageOutput> {
    if (claim.stage === "clinical_validation") {
      const route = routeAgent({
        workflowType: "medication_access",
        workflowState: claim.stage,
        requiredCapability: "clinical.findings",
        persona: "service_account",
        tenantId: claim.tenantId,
      });
      const validation = await this.taskExecutor.execute({
        id: `${claim.workflowId}:${claim.stage}:${claim.extractionId}:${claim.attempt}`,
        engine: "ML-ENG-013",
        capability: route.capabilityName,
        action: "clinical_warning",
        actor: "system",
        tenantId: claim.tenantId,
        correlationId: claim.correlationId,
        agentId: route.agentId,
        agentVersion: route.agentVersion,
        persona: "service_account",
        requiresHumanApproval: route.requiresHumanApproval,
        context: {
          tenantId: claim.tenantId,
          patientId: claim.patientId,
          prescriptionId: claim.prescriptionId,
          workflowId: claim.workflowId,
        },
        input: { itemCount: claim.extraction.items.length },
        execute: async () => this.quality.validate(claim.extraction),
      });
      if (validation.status !== "completed") {
        throw new ClinicalPipelineError(
          "clinical_task_unexpected_approval",
          "Advisory clinical validation did not complete",
          false,
        );
      }
      return { stage: claim.stage, findings: validation.output };
    }
    const action = claim.stage === "ocr" ? "ocr" : "prescription_parse";
    const route = claim.stage === "ocr"
      ? routeAgent({
          workflowType: "medication_access",
          workflowState: claim.stage,
          requiredCapability: "prescription.ocr",
          persona: "service_account",
          tenantId: claim.tenantId,
        })
      : null;
    const result = await this.taskExecutor.execute({
      id: `${claim.workflowId}:${claim.stage}:${claim.extractionId}:${claim.attempt}`,
      engine: "ML-ENG-013",
      capability: route?.capabilityName ?? "ML-CAP-006",
      action,
      actor: "system",
      tenantId: claim.tenantId,
      correlationId: claim.correlationId,
      agentId: route?.agentId ?? "prescription-reader",
      agentVersion: route?.agentVersion ?? "1.0.0",
      persona: "service_account",
      requiresHumanApproval: route?.requiresHumanApproval ?? false,
      context: {
        tenantId: claim.tenantId,
        patientId: claim.patientId,
        prescriptionId: claim.prescriptionId,
        workflowId: claim.workflowId,
      },
      input: claim.stage === "ocr"
        ? { mediaType: claim.source.mediaType, sizeBytes: claim.source.sizeBytes }
        : { characterCount: claim.ocr.text.length },
      execute: async () => {
        if (claim.stage === "ocr") {
          const bytes = await this.source.download(
            claim.source.bucket,
            claim.source.path,
            signal,
          );
          if (bytes.byteLength !== claim.source.sizeBytes) {
            throw new ClinicalPipelineError(
              "ocr_source_size_mismatch",
              "The OCR source size does not match intake evidence",
              false,
            );
          }
          if (await this.source.sha256(bytes) !== claim.source.sha256) {
            throw new ClinicalPipelineError(
              "ocr_source_integrity_failed",
              "The OCR source integrity check failed",
              false,
            );
          }
          return this.ocr.extract({
            bytes,
            mediaType: claim.source.mediaType,
            correlationId: claim.correlationId,
            signal,
          });
        }
        return this.parser.parse({
          text: claim.ocr.text,
          correlationId: claim.correlationId,
          signal,
        });
      },
    });
    if (result.status !== "completed") {
      throw new ClinicalPipelineError(
        "clinical_task_unexpected_approval",
        "A non-clinical processing task requested human approval",
        false,
      );
    }
    return claim.stage === "ocr"
      ? { stage: claim.stage, result: ocrResultSchema.parse(result.output) }
      : {
          stage: claim.stage,
          extraction: structuredPrescriptionSchema.parse(result.output),
        };
  }

  verify(
    claim: ClinicalPipelineClaim,
    output: StageOutput,
    signal: AbortSignal,
  ) {
    if (signal.aborted) throw signal.reason;
    if (claim.stage !== output.stage) {
      throw new ClinicalPipelineError(
        "clinical_stage_output_mismatch",
        "Clinical stage output does not match the claimed stage",
        false,
      );
    }
  }

  async publish(
    claim: ClinicalPipelineClaim,
    output: StageOutput,
    signal: AbortSignal,
  ) {
    void claim;
    void output;
    void signal;
    // Domain events are written atomically by the repository completion command.
  }

  async complete(
    claim: ClinicalPipelineClaim,
    output: StageOutput,
    signal: AbortSignal,
  ) {
    const workerId = claim.workerId;
    if (claim.stage === "ocr" && output.stage === "ocr") {
      await this.repository.completeOcr({
        claim,
        workerId,
        result: output.result,
        signal,
      });
    } else if (claim.stage === "parsing" && output.stage === "parsing") {
      await this.repository.completeParsing({
        claim,
        workerId,
        extraction: output.extraction,
        signal,
      });
    } else if (
      claim.stage === "clinical_validation"
      && output.stage === "clinical_validation"
    ) {
      await this.repository.completeValidation({
        claim,
        workerId,
        findings: output.findings,
        signal,
      });
    }
  }

  async runNext(workerId: string): Promise<{
    status: "idle" | "completed" | "retrying" | "failed";
    stage?: ClinicalPipelineStage;
    prescriptionId?: string;
  }> {
    const signal = AbortSignal.timeout(45_000);
    const claim = await this.initialize(workerId, signal);
    if (!claim) return { status: "idle" };
    if (claim.workerId !== workerId) {
      throw new ClinicalPipelineError(
        "clinical_worker_fence_invalid",
        "The clinical claim belongs to another worker",
        false,
      );
    }
    try {
      await this.validate(claim, signal);
      const output = await this.execute(claim, signal);
      await this.verify(claim, output, signal);
      await this.publish(claim, output, signal);
      await this.complete(claim, output, signal);
      return {
        status: "completed",
        stage: claim.stage,
        prescriptionId: claim.prescriptionId,
      };
    } catch (error) {
      const known = error instanceof ClinicalPipelineError
        ? error
        : error instanceof z.ZodError
          ? new ClinicalPipelineError(
              "clinical_provider_contract_invalid",
              "Clinical provider output did not satisfy its contract",
              false,
            )
          : new ClinicalPipelineError(
              signal.aborted ? "clinical_stage_timeout" : "clinical_stage_failed",
              "Clinical processing failed",
              true,
            );
      const status = await this.repository.fail({
        claim,
        workerId,
        errorCode: known.code,
        retryable: known.retryable,
        signal: AbortSignal.timeout(5_000),
      });
      return { status, stage: claim.stage, prescriptionId: claim.prescriptionId };
    }
  }
}
