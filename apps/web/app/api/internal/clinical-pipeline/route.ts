import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  authorizedWorkerRequest,
  createClinicalPipelineWorker,
} from "../../../../lib/clinical-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MEDLINK_CLINICAL_WORKER_TOKEN: z.string().min(32),
  MEDLINK_OCR_PROVIDER_URL: z.string().url(),
  MEDLINK_PARSER_PROVIDER_URL: z.string().url(),
});
const inputSchema = z.object({
  limit: z.number().int().min(1).max(5).default(3),
});

export async function POST(request: Request) {
  const environment = environmentSchema.safeParse(process.env);
  if (!environment.success) {
    return Response.json(
      { error: { code: "clinical_worker_not_configured" } },
      { status: 503 },
    );
  }
  if (!authorizedWorkerRequest(
    request,
    environment.data.MEDLINK_CLINICAL_WORKER_TOKEN,
  )) {
    return Response.json(
      { error: { code: "worker_authentication_required" } },
      { status: 401 },
    );
  }
  const parsed = inputSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_worker_request" } },
      { status: 400 },
    );
  }
  const database = createClient(
    environment.data.NEXT_PUBLIC_SUPABASE_URL,
    environment.data.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const worker = createClinicalPipelineWorker(database);
  const workerId = `clinical-worker:${crypto.randomUUID()}`;
  const results = [];
  for (let index = 0; index < parsed.data.limit; index += 1) {
    const result = await worker.runNext(workerId);
    results.push(result);
    if (result.status !== "completed") break;
  }
  return Response.json({ data: { workerId, results } });
}
