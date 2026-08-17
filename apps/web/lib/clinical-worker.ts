import { createHash } from "node:crypto";
import {
  AgentTaskExecutor,
  MvpAgentPolicy,
  SupabaseAgentTaskObserver,
  type AgentTaskObserver,
} from "@medlink/agent-runtime";
import { runtimeLogger } from "@medlink/observability";
import {
  ClinicalPipelineError,
  ClinicalPipelineWorker,
  ocrResultSchema,
  structuredPrescriptionSchema,
  type ClinicalPipelineClaim,
  type ClinicalPipelineRepository,
  type OcrProvider,
  type PipelineFinding,
  type PipelineSourceStore,
  type PrescriptionStructureProvider,
} from "@medlink/prescription";
import type { RuntimeContext } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.string().uuid();
const baseClaim = z.object({
  extractionId: uuid,
  pipelineId: uuid,
  workflowId: uuid,
  sourceEventId: uuid,
  tenantId: uuid,
  patientId: uuid,
  prescriptionId: uuid,
  correlationId: z.string().min(1),
  attempt: z.number().int().min(1).max(5),
  workerId: z.string().min(1).max(200),
  leaseToken: uuid,
});
const claimSchema = z.discriminatedUnion("stage", [
  baseClaim.extend({
    stage: z.literal("ocr"),
    source: z.object({
      bucket: z.literal("prescriptions-private"),
      path: z.string().min(1).max(1_000),
      mediaType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
      sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  }).strict(),
  baseClaim.extend({
    stage: z.literal("parsing"),
    ocr: ocrResultSchema,
  }).strict(),
  baseClaim.extend({
    stage: z.literal("clinical_validation"),
    ocr: ocrResultSchema,
    extraction: structuredPrescriptionSchema,
  }).strict(),
]);

const workerEnvironmentSchema = z.object({
  MEDLINK_OCR_PROVIDER_URL: z.string().url(),
  MEDLINK_PARSER_PROVIDER_URL: z.string().url(),
  MEDLINK_OCR_PROVIDER_TOKEN: z.string().min(1).optional(),
  MEDLINK_PARSER_PROVIDER_TOKEN: z.string().min(1).optional(),
});

function providerFailure(code: string, cause?: unknown) {
  return new ClinicalPipelineError(
    code,
    "A clinical processing provider is unavailable",
    true,
    { cause },
  );
}

class HttpOcrProvider implements OcrProvider {
  constructor(
    private readonly endpoint: string,
    private readonly token?: string,
  ) {}

  async extract(input: {
    bytes: Uint8Array;
    mediaType: string;
    correlationId: string;
    signal: AbortSignal;
  }) {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": input.mediaType,
          "X-Correlation-Id": input.correlationId,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: input.bytes as BodyInit,
        signal: input.signal,
      });
    } catch (error) {
      throw providerFailure("ocr_provider_unavailable", error);
    }
    if (!response.ok) throw providerFailure("ocr_provider_failed");
    try {
      return await response.json();
    } catch (error) {
      throw new ClinicalPipelineError(
        "ocr_provider_response_invalid",
        "The OCR provider returned an invalid response",
        false,
        { cause: error },
      );
    }
  }
}

class HttpPrescriptionStructureProvider
implements PrescriptionStructureProvider {
  constructor(
    private readonly endpoint: string,
    private readonly token?: string,
  ) {}

  async parse(input: {
    text: string;
    correlationId: string;
    signal: AbortSignal;
  }) {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": input.correlationId,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ text: input.text }),
        signal: input.signal,
      });
    } catch (error) {
      throw providerFailure("parser_provider_unavailable", error);
    }
    if (!response.ok) throw providerFailure("parser_provider_failed");
    try {
      return await response.json();
    } catch (error) {
      throw new ClinicalPipelineError(
        "parser_provider_response_invalid",
        "The parser provider returned an invalid response",
        false,
        { cause: error },
      );
    }
  }
}

class SupabasePipelineSource implements PipelineSourceStore {
  constructor(private readonly database: SupabaseClient) {}

  async download(bucket: string, path: string, signal: AbortSignal) {
    const signed = await this.database.storage.from(bucket)
      .createSignedUrl(path, 60);
    if (signed.error || !signed.data) {
      throw new ClinicalPipelineError(
        "ocr_source_unavailable",
        "The prescription source is unavailable",
        true,
      );
    }
    const response = await fetch(signed.data.signedUrl, { signal });
    if (!response.ok) {
      throw new ClinicalPipelineError(
        "ocr_source_download_failed",
        "The prescription source could not be downloaded",
        true,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async sha256(bytes: Uint8Array) {
    return createHash("sha256").update(bytes).digest("hex");
  }
}

function rpcFailure(code: string, cause: unknown) {
  return new ClinicalPipelineError(
    code,
    "The clinical pipeline state could not be persisted",
    true,
    { cause },
  );
}

class SupabaseClinicalPipelineRepository
implements ClinicalPipelineRepository {
  constructor(private readonly database: SupabaseClient) {}

  async claim(workerId: string, signal: AbortSignal) {
    const { data, error } = await this.database.rpc(
      "claim_clinical_pipeline_stage",
      { worker_id: workerId, lease_seconds: 60 },
    ).abortSignal(signal);
    if (error) throw rpcFailure("clinical_claim_failed", error);
    if (!data) return null;
    return claimSchema.parse(data) as ClinicalPipelineClaim;
  }

  private async complete(
    name:
      | "complete_clinical_ocr"
      | "complete_clinical_parsing"
      | "complete_clinical_validation",
    claim: ClinicalPipelineClaim,
    workerId: string,
    payloadName: "result" | "extraction" | "findings",
    payload: unknown,
    signal: AbortSignal,
  ) {
    const { error } = await this.database.rpc(name, {
      source_event_id: claim.sourceEventId,
      worker_id: workerId,
      lease_token: claim.leaseToken,
      [payloadName]: payload,
    }).abortSignal(signal);
    if (error) throw rpcFailure(`${claim.stage}_completion_failed`, error);
  }

  completeOcr(input: {
    claim: Extract<ClinicalPipelineClaim, { stage: "ocr" }>;
    workerId: string;
    result: z.infer<typeof ocrResultSchema>;
    signal: AbortSignal;
  }) {
    return this.complete(
      "complete_clinical_ocr",
      input.claim,
      input.workerId,
      "result",
      input.result,
      input.signal,
    );
  }

  completeParsing(input: {
    claim: Extract<ClinicalPipelineClaim, { stage: "parsing" }>;
    workerId: string;
    extraction: z.infer<typeof structuredPrescriptionSchema>;
    signal: AbortSignal;
  }) {
    return this.complete(
      "complete_clinical_parsing",
      input.claim,
      input.workerId,
      "extraction",
      input.extraction,
      input.signal,
    );
  }

  completeValidation(input: {
    claim: Extract<ClinicalPipelineClaim, { stage: "clinical_validation" }>;
    workerId: string;
    findings: readonly PipelineFinding[];
    signal: AbortSignal;
  }) {
    return this.complete(
      "complete_clinical_validation",
      input.claim,
      input.workerId,
      "findings",
      input.findings,
      input.signal,
    );
  }

  async fail(input: {
    claim: ClinicalPipelineClaim;
    workerId: string;
    errorCode: string;
    retryable: boolean;
    signal: AbortSignal;
  }) {
    const { data, error } = await this.database.rpc(
      "fail_clinical_pipeline_stage",
      {
        source_event_id: input.claim.sourceEventId,
        worker_id: input.workerId,
        lease_token: input.claim.leaseToken,
        error_code: input.errorCode,
        retryable: input.retryable,
      },
    ).abortSignal(input.signal);
    if (error) throw rpcFailure("clinical_failure_record_failed", error);
    return z.enum(["retrying", "failed"]).parse(data);
  }
}

function taskObserver(database: SupabaseClient): AgentTaskObserver {
  const durable = new SupabaseAgentTaskObserver(database);
  return {
    async record(event) {
      await durable.record(event);
      const context: RuntimeContext = {
        correlationId: event.correlationId,
        requestId: event.taskId,
        tenantId: event.tenantId,
        organizationId: event.tenantId,
        userId: "00000000-0000-0000-0000-000000000000",
        role: "service_account",
        locale: "en-NG",
        timezone: "Africa/Lagos",
        channel: "worker",
        apiVersion: "v1",
      };
      runtimeLogger(context, {
        service: "clinical-pipeline-worker",
        component: "agent-runtime",
        operation: event.action,
      }).info("clinical task state changed", {
        durationMs: event.durationMs,
        errorCode: event.errorCode,
        attributes: {
          event: "agent.task.telemetry",
          taskId: event.taskId,
          engine: event.engine,
          capability: event.capability,
          status: event.status,
        },
      });
    },
  };
}

export function createClinicalPipelineWorker(database: SupabaseClient) {
  const environment = workerEnvironmentSchema.parse(process.env);
  return new ClinicalPipelineWorker(
    new SupabaseClinicalPipelineRepository(database),
    new SupabasePipelineSource(database),
    new HttpOcrProvider(
      environment.MEDLINK_OCR_PROVIDER_URL,
      environment.MEDLINK_OCR_PROVIDER_TOKEN,
    ),
    new HttpPrescriptionStructureProvider(
      environment.MEDLINK_PARSER_PROVIDER_URL,
      environment.MEDLINK_PARSER_PROVIDER_TOKEN,
    ),
    new AgentTaskExecutor(new MvpAgentPolicy(), taskObserver(database)),
  );
}

export { authorizedWorkerRequest } from "./worker-auth";

export function clinicalWorkerConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.MEDLINK_CLINICAL_WORKER_TOKEN
    && process.env.MEDLINK_OCR_PROVIDER_URL
    && process.env.MEDLINK_PARSER_PROVIDER_URL,
  );
}
