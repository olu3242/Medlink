import type {
  PharmacistDashboard,
  PharmacistReviewDetail,
  PharmacistReviewSummary,
} from "@medlink/clinical";
import type { InventoryBatch } from "@medlink/inventory";
import { cookies, headers } from "next/headers";
import { resolveServerOrigin } from "@medlink/platform";

export type Review = PharmacistReviewSummary;
export type ReviewDetail = PharmacistReviewDetail;

async function get<T>(path: string) {
  const [incoming, cookieStore] = await Promise.all([headers(), cookies()]);
  const origin = resolveServerOrigin(
    ["MEDLINK_PHARMACIST_URL", "MEDLINK_API_URL"],
    "http://localhost:3003",
    "pharmacist API calls",
  );
  const forwarded = new Headers({ Accept: "application/json" });
  const cookieHeader = incoming.get("cookie") ?? cookieStore.getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (cookieHeader) forwarded.set("cookie", cookieHeader);
  for (const name of ["authorization", "x-medlink-tenant-id"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const response = await fetch(new URL(path, origin), {
    cache: "no-store",
    headers: forwarded,
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(
      `Review request failed (${response.status}, ${problem?.code ?? "unknown"})`,
    );
  }
  return (await response.json() as { data: T }).data;
}

export const queue = () =>
  get<PharmacistReviewSummary[]>("/api/v1/review");
export const review = (id: string) =>
  get<PharmacistReviewDetail>(`/api/v1/review/${encodeURIComponent(id)}`);
export const dashboard = () =>
  get<PharmacistDashboard>("/api/v1/dashboard");
export const inventoryAlerts = () =>
  get<InventoryBatch[]>("/api/v1/inventory");

export type ReviewDecision = "approved" | "rejected" | "needs_information";

export async function decide(
  id: string,
  input: { decision: ReviewDecision; recommendation: string },
): Promise<void> {
  const origin = resolveServerOrigin(
    ["MEDLINK_PHARMACIST_URL", "MEDLINK_API_URL"],
    "http://localhost:3003",
    "pharmacist API calls",
  );
  const response = await fetch(
    new URL(`/api/v1/review/${encodeURIComponent(id)}`, origin),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error("Review decision failed");
}
