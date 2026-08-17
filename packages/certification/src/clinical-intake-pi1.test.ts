import {
  AgentTaskExecutor,
  MvpAgentPolicy,
  type AgentTaskTelemetry,
} from "@medlink/agent-runtime";
import {
  PharmacistReviewService,
  type PharmacistReviewDecision,
  type PharmacistReviewDetail,
  type PharmacistReviewRepository,
  type PharmacistReviewSummary,
} from "@medlink/clinical";
import {
  InventoryManagement,
  type InventoryManagementRepository,
} from "@medlink/inventory";
import {
  ClinicalPipelineWorker,
  type ClinicalPipelineClaim,
  type ClinicalPipelineRepository,
  type OcrResult,
  type PipelineFinding,
  type StructuredPrescription,
} from "@medlink/prescription";
import { describe, expect, it, vi } from "vitest";

const identifiers = {
  extractionId: "11111111-1111-4111-8111-111111111111",
  pipelineId: "22222222-2222-4222-8222-222222222222",
  workflowId: "33333333-3333-4333-8333-333333333333",
  sourceEventId: "44444444-4444-4444-8444-444444444444",
  tenantId: "55555555-5555-4555-8555-555555555555",
  patientId: "66666666-6666-4666-8666-666666666666",
  prescriptionId: "77777777-7777-4777-8777-777777777777",
  leaseToken: "88888888-8888-4888-8888-888888888888",
  reviewId: "99999999-9999-4999-8999-999999999999",
  pharmacistId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  prescriptionItemId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  medicineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const ocrResult: OcrResult = {
  text: "Amoxicillin 500 mg. Take one capsule three times daily.",
  pageCount: 1,
  confidence: 0.94,
  provider: "test-ocr",
  model: "test-v1",
};

const extraction: StructuredPrescription = {
  patientName: { value: "Pilot Patient", confidence: 0.91 },
  prescriberName: { value: "Pilot Prescriber", confidence: 0.9 },
  items: [{
    medicineName: { value: "Amoxicillin", confidence: 0.96 },
    strength: { value: "500 mg", confidence: 0.94 },
    dosage: {
      value: "One capsule three times daily",
      confidence: 0.92,
    },
  }],
  overallConfidence: 0.93,
};

class Pi1Harness
implements ClinicalPipelineRepository, PharmacistReviewRepository {
  private readonly claims: ClinicalPipelineClaim[];
  private findings: readonly PipelineFinding[] = [];
  private decision: PharmacistReviewDecision | null = null;
  readonly completedStages: string[] = [];

  constructor() {
    this.claims = [{
      ...identifiers,
      stage: "ocr",
      correlationId: "pi1-correlation",
      attempt: 1,
      workerId: "worker-a",
      source: {
        bucket: "prescriptions-private",
        path: `${identifiers.tenantId}/${identifiers.patientId}/source.jpg`,
        mediaType: "image/jpeg",
        sizeBytes: 3,
        sha256: "a".repeat(64),
      },
    }];
  }

  async claim() {
    return this.claims.shift() ?? null;
  }

  async completeOcr(input: {
    result: OcrResult;
  }) {
    this.completedStages.push("ocr");
    this.claims.push({
      ...identifiers,
      workflowId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      leaseToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      stage: "parsing",
      correlationId: "pi1-correlation",
      attempt: 1,
      workerId: "worker-a",
      ocr: input.result,
    });
  }

  async completeParsing(input: {
    extraction: StructuredPrescription;
  }) {
    this.completedStages.push("parsing");
    this.claims.push({
      ...identifiers,
      workflowId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      sourceEventId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      leaseToken: "12121212-1212-4212-8212-121212121212",
      stage: "clinical_validation",
      correlationId: "pi1-correlation",
      attempt: 1,
      workerId: "worker-a",
      ocr: ocrResult,
      extraction: input.extraction,
    });
  }

  async completeValidation(input: {
    findings: readonly PipelineFinding[];
  }) {
    this.completedStages.push("clinical_validation");
    this.findings = input.findings;
  }

  async fail() {
    return "failed" as const;
  }

  private summary(): PharmacistReviewSummary {
    return {
      id: identifiers.reviewId,
      prescriptionId: identifiers.prescriptionId,
      medicineNames: ["Amoxicillin"],
      patientReference: "Patient ...66666666",
      priority: "high",
      reason: this.findings[0]?.title
        ?? "Independent pharmacist review required",
      status: this.decision ?? "pending",
      createdAt: "2026-07-30T20:00:00.000Z",
    };
  }

  async list(tenantId: string) {
    if (tenantId !== identifiers.tenantId || this.decision) return [];
    return [this.summary()];
  }

  async find(tenantId: string, reviewId: string) {
    if (
      tenantId !== identifiers.tenantId
      || reviewId !== identifiers.reviewId
      || this.findings.length === 0
    ) return null;
    return {
      ...this.summary(),
      sourceDocument: null,
      prescriptionText: ocrResult.text,
      clinicalFlags: this.findings.map((finding, index) => ({
        id: `13131313-1313-4313-8313-${String(index + 1).padStart(12, "0")}`,
        title: finding.title,
        detail: finding.detail,
        severity: finding.severity,
        requiresAcknowledgement: finding.requiresAcknowledgement,
        acknowledged: false,
      })),
      extractedItems: extraction.items.map((item) => ({
        id: identifiers.prescriptionItemId,
        medicineId: identifiers.medicineId,
        medicineName: item.medicineName.value,
        strength: item.strength.value,
        dosage: item.dosage.value,
        confidence: item.medicineName.confidence,
        canonicalMedicine: {
          brandName: "Amoxil",
          genericName: "Amoxicillin",
          strength: "500 mg",
          dosageForm: "Capsule",
        },
      })),
      patientClarification: null,
      evidenceHash: "b".repeat(64),
    } satisfies PharmacistReviewDetail;
  }

  async decide(input: {
    tenantId: string;
    reviewId: string;
    decision: PharmacistReviewDecision;
    acknowledgedFindingIds: readonly string[];
    reviewedItems: readonly {
      prescriptionItemId: string;
      medicineId: string;
    }[];
  }) {
    const detail = await this.find(input.tenantId, input.reviewId);
    if (!detail) throw new Error("review not found");
    const required = detail.clinicalFlags
      .filter(({ requiresAcknowledgement }) => requiresAcknowledgement)
      .map(({ id }) => id);
    if (required.some((id) => !input.acknowledgedFindingIds.includes(id))) {
      throw new Error("required finding was not acknowledged");
    }
    this.decision = input.decision;
    return {
      reviewId: input.reviewId,
      prescriptionId: identifiers.prescriptionId,
      decision: input.decision,
    };
  }
}

describe("RC2 PI-1 clinical intake acceptance", () => {
  it("moves immutable upload evidence through ARC tasks to human review", async () => {
    const harness = new Pi1Harness();
    const telemetry: AgentTaskTelemetry[] = [];
    const worker = new ClinicalPipelineWorker(
      harness,
      {
        download: async () => new Uint8Array([1, 2, 3]),
        sha256: async () => "a".repeat(64),
      },
      { extract: async () => ocrResult },
      { parse: async () => extraction },
      new AgentTaskExecutor(new MvpAgentPolicy(), {
        record(event) {
          telemetry.push(event);
        },
      }),
    );

    await expect(worker.runNext("worker-a")).resolves.toMatchObject({
      status: "completed",
      stage: "ocr",
    });
    await expect(worker.runNext("worker-a")).resolves.toMatchObject({
      status: "completed",
      stage: "parsing",
    });
    await expect(worker.runNext("worker-a")).resolves.toMatchObject({
      status: "completed",
      stage: "clinical_validation",
    });

    expect(harness.completedStages).toEqual([
      "ocr",
      "parsing",
      "clinical_validation",
    ]);
    expect(telemetry.map(({ status }) => status)).toEqual([
      "started",
      "completed",
      "started",
      "completed",
      "started",
      "completed",
    ]);
    expect(telemetry.at(-1)).toMatchObject({
      agentId: "clinical-review-assistant",
      capability: "flag_validation_findings",
      requiresHumanApproval: true,
      status: "completed",
    });

    const reviews = new PharmacistReviewService(harness);
    await expect(reviews.list(identifiers.tenantId)).resolves.toHaveLength(1);
    const detail = await reviews.get(
      identifiers.tenantId,
      identifiers.reviewId,
    );
    const acknowledgements = detail.clinicalFlags
      .filter(({ requiresAcknowledgement }) => requiresAcknowledgement)
      .map(({ id }) => id);

    await expect(reviews.decide({
      tenantId: identifiers.tenantId,
      reviewId: identifiers.reviewId,
      pharmacistId: identifiers.pharmacistId,
      decision: "approved",
      rationale: "Verified against the immutable source and extraction.",
      acknowledgedFindingIds: acknowledgements,
      reviewedItems: [{
        prescriptionItemId: identifiers.prescriptionItemId,
        medicineId: identifiers.medicineId,
      }],
      idempotencyKey: "pi1-review-decision",
      correlationId: "pi1-correlation",
      requestId: "pi1-request",
    })).resolves.toMatchObject({ decision: "approved" });
    await expect(reviews.list(identifiers.tenantId)).resolves.toEqual([]);

    const inventory = {
      list: vi.fn().mockResolvedValue([]),
      find: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      changeStock: vi.fn(),
      transactions: vi.fn().mockResolvedValue([]),
      availability: vi.fn().mockResolvedValue([]),
    } satisfies InventoryManagementRepository;
    await new InventoryManagement(inventory).availability({
      organizationId: identifiers.tenantId,
      medicineId: detail.extractedItems[0]!.medicineId!,
      quantity: 1,
    });
    expect(inventory.availability).toHaveBeenCalledWith({
      organizationId: identifiers.tenantId,
      medicineId: identifiers.medicineId,
      quantity: 1,
    });
  });
});
