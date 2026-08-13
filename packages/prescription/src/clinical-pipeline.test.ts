import {
  AgentTaskExecutor,
  MvpAgentPolicy,
} from "@medlink/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  ClinicalPipelineError,
  ClinicalPipelineWorker,
  PrescriptionQualityValidator,
  type ClinicalPipelineClaim,
  type ClinicalPipelineRepository,
  type OcrClaim,
  type OcrProvider,
  type PipelineSourceStore,
  type PrescriptionStructureProvider,
} from "./clinical-pipeline";
import type { StructuredPrescription } from "./model";

const ids = {
  extractionId: "11111111-1111-4111-8111-111111111111",
  pipelineId: "22222222-2222-4222-8222-222222222222",
  workflowId: "33333333-3333-4333-8333-333333333333",
  sourceEventId: "88888888-8888-4888-8888-888888888888",
  tenantId: "44444444-4444-4444-8444-444444444444",
  patientId: "55555555-5555-4555-8555-555555555555",
  prescriptionId: "66666666-6666-4666-8666-666666666666",
  leaseToken: "77777777-7777-4777-8777-777777777777",
} as const;

const ocrResult = {
  text: "Amoxicillin 500 mg. Take one capsule three times daily.",
  pageCount: 1,
  confidence: 0.94,
  provider: "sandbox-ocr",
  model: "ocr-v1",
} as const;

const structuredPrescription: StructuredPrescription = {
  patientName: { value: "Test Patient", confidence: 0.91 },
  prescriberName: { value: "Test Prescriber", confidence: 0.9 },
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

function ocrClaim(overrides: Partial<OcrClaim> = {}): OcrClaim {
  return {
    ...ids,
    stage: "ocr",
    correlationId: "correlation-1",
    attempt: 1,
    workerId: "worker-a",
    source: {
      bucket: "prescriptions-private",
      path: `${ids.tenantId}/${ids.patientId}/prescription.jpg`,
      mediaType: "image/jpeg",
      sizeBytes: 3,
      sha256: "a".repeat(64),
    },
    ...overrides,
  };
}

function repository(claim: ClinicalPipelineClaim | null) {
  const claimNext = vi.fn<ClinicalPipelineRepository["claim"]>(
    async () => claim,
  );
  const completeOcr = vi.fn<ClinicalPipelineRepository["completeOcr"]>(
    async () => undefined,
  );
  const completeParsing = vi.fn<
    ClinicalPipelineRepository["completeParsing"]
  >(async () => undefined);
  const completeValidation = vi.fn<
    ClinicalPipelineRepository["completeValidation"]
  >(async () => undefined);
  const fail = vi.fn<ClinicalPipelineRepository["fail"]>(
    async () => "failed",
  );
  const value = {
    claim: claimNext,
    completeOcr,
    completeParsing,
    completeValidation,
    fail,
  } satisfies ClinicalPipelineRepository;
  return value;
}

function dependencies(input: {
  claim: ClinicalPipelineClaim | null;
  sourceHash?: string;
  ocrOutput?: unknown;
  parseOutput?: unknown;
}) {
  const database = repository(input.claim);
  const source = {
    download: vi.fn(async () => new Uint8Array([1, 2, 3])),
    sha256: vi.fn(async () => input.sourceHash ?? "a".repeat(64)),
  } satisfies PipelineSourceStore;
  const ocr = {
    extract: vi.fn(async () => input.ocrOutput ?? ocrResult),
  } satisfies OcrProvider;
  const parser = {
    parse: vi.fn(async () => input.parseOutput ?? structuredPrescription),
  } satisfies PrescriptionStructureProvider;
  const observer = { record: vi.fn() };
  const worker = new ClinicalPipelineWorker(
    database,
    source,
    ocr,
    parser,
    new AgentTaskExecutor(new MvpAgentPolicy(), observer),
  );
  return { database, observer, ocr, parser, source, worker };
}

describe("clinical prescription pipeline", () => {
  it("completes OCR only after source integrity verification", async () => {
    const value = dependencies({ claim: ocrClaim() });

    await expect(value.worker.runNext("worker-a")).resolves.toEqual({
      status: "completed",
      stage: "ocr",
      prescriptionId: ids.prescriptionId,
    });

    expect(value.source.download).toHaveBeenCalledOnce();
    expect(value.source.sha256).toHaveBeenCalledOnce();
    expect(value.ocr.extract).toHaveBeenCalledWith(expect.objectContaining({
      mediaType: "image/jpeg",
      correlationId: "correlation-1",
    }));
    expect(value.database.completeOcr).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-a",
        claim: expect.objectContaining({ leaseToken: ids.leaseToken }),
        result: ocrResult,
      }),
    );
    expect(value.database.fail).not.toHaveBeenCalled();
  });

  it("fails closed without invoking OCR when source integrity differs", async () => {
    const value = dependencies({
      claim: ocrClaim(),
      sourceHash: "b".repeat(64),
    });

    await expect(value.worker.runNext("worker-a")).resolves.toMatchObject({
      status: "failed",
      stage: "ocr",
    });

    expect(value.ocr.extract).not.toHaveBeenCalled();
    expect(value.database.completeOcr).not.toHaveBeenCalled();
    expect(value.database.fail).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "worker-a",
      errorCode: "ocr_source_integrity_failed",
      retryable: false,
    }));
  });

  it("enforces the parsing provider contract before persistence", async () => {
    const claim: ClinicalPipelineClaim = {
      ...ids,
      stage: "parsing",
      correlationId: "correlation-2",
      attempt: 1,
      workerId: "worker-a",
      ocr: ocrResult,
    };
    const successful = dependencies({ claim });

    await expect(successful.worker.runNext("worker-a")).resolves.toMatchObject({
      status: "completed",
      stage: "parsing",
    });
    expect(successful.database.completeParsing).toHaveBeenCalledWith(
      expect.objectContaining({ extraction: structuredPrescription }),
    );

    const invalid = dependencies({
      claim,
      parseOutput: { ...structuredPrescription, unexpected: "field" },
    });
    await expect(invalid.worker.runNext("worker-a")).resolves.toMatchObject({
      status: "failed",
      stage: "parsing",
    });
    expect(invalid.database.completeParsing).not.toHaveBeenCalled();
    expect(invalid.database.fail).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "clinical_provider_contract_invalid",
      retryable: false,
    }));
  });

  it("creates explicit quality findings for ambiguous clinical evidence", () => {
    const findings = new PrescriptionQualityValidator().validate({
      patientName: { value: "Test Patient", confidence: 0.7 },
      items: [{
        medicineName: { value: "Amoxicillin", confidence: 0.95 },
        strength: { value: "500 mg", confidence: 0.91 },
        dosage: { value: "Unclear", confidence: 0.6 },
      }],
      overallConfidence: 0.3,
    });

    expect(findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ambiguous_patientName",
      "ambiguous_items.0.dosage",
      "prescription_illegible",
      "clinical_context_requires_pharmacist",
    ]));
    expect(findings.every(({ requiresAcknowledgement }) =>
      requiresAcknowledgement)).toBe(true);
    expect(findings.find(({ code }) => code === "prescription_illegible"))
      .toMatchObject({ severity: "critical", confidence: 0.3 });
  });

  it("classifies an unexpected provider outage as retryable", async () => {
    const value = dependencies({ claim: ocrClaim() });
    value.ocr.extract.mockRejectedValueOnce(new Error("provider unavailable"));
    value.database.fail.mockResolvedValueOnce("retrying");

    await expect(value.worker.runNext("worker-a")).resolves.toMatchObject({
      status: "retrying",
      stage: "ocr",
    });
    expect(value.database.fail).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "clinical_stage_failed",
      retryable: true,
    }));
    expect(value.database.completeOcr).not.toHaveBeenCalled();
  });

  it("rejects a claim fenced to another worker before processing", async () => {
    const value = dependencies({
      claim: ocrClaim({ workerId: "worker-b" }),
    });

    await expect(value.worker.runNext("worker-a")).rejects.toMatchObject({
      code: "clinical_worker_fence_invalid",
    } satisfies Partial<ClinicalPipelineError>);
    expect(value.source.download).not.toHaveBeenCalled();
    expect(value.ocr.extract).not.toHaveBeenCalled();
    expect(value.database.fail).not.toHaveBeenCalled();
  });

  it("produces findings but never an AI clinical decision", async () => {
    const claim: ClinicalPipelineClaim = {
      ...ids,
      stage: "clinical_validation",
      correlationId: "correlation-3",
      attempt: 1,
      workerId: "worker-a",
      ocr: ocrResult,
      extraction: structuredPrescription,
    };
    const value = dependencies({ claim });

    await expect(value.worker.runNext("worker-a")).resolves.toMatchObject({
      status: "completed",
      stage: "clinical_validation",
    });
    expect(value.ocr.extract).not.toHaveBeenCalled();
    expect(value.parser.parse).not.toHaveBeenCalled();
    expect(value.observer.record).not.toHaveBeenCalled();
    expect(value.database.completeValidation).toHaveBeenCalledOnce();
    const completion = value.database.completeValidation.mock.calls[0]?.[0];
    expect(completion).toBeDefined();
    expect(completion).not.toHaveProperty("decision");
    expect(completion?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "clinical_context_requires_pharmacist",
        requiresAcknowledgement: true,
      }),
    ]));
  });
});
