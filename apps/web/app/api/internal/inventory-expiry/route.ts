import {
  InventoryExpiryWorker,
  SupabaseInventoryExpiryRepository,
} from "@medlink/inventory";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authorizedWorkerRequest } from "../../../../lib/worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MEDLINK_INVENTORY_WORKER_TOKEN: z.string().min(32),
});
const inputSchema = z.object({
  limit: z.number().int().min(1).max(1_000).default(100),
}).strict();

export async function POST(request: Request) {
  const environment = environmentSchema.safeParse(process.env);
  if (!environment.success) {
    return Response.json(
      { error: { code: "inventory_worker_not_configured" } },
      { status: 503 },
    );
  }
  if (!authorizedWorkerRequest(
    request,
    environment.data.MEDLINK_INVENTORY_WORKER_TOKEN,
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
  const data = await new InventoryExpiryWorker(
    new SupabaseInventoryExpiryRepository(database),
  ).run(parsed.data.limit);
  return Response.json({ data });
}
