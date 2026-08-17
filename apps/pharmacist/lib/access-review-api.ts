import { headers } from "next/headers";
import type { AccessReviewDetail } from "./access-review-application";

export async function accessReview(id: string): Promise<AccessReviewDetail> {
  const incoming = await headers();
  const origin = process.env.MEDLINK_PHARMACIST_URL
    ?? process.env.MEDLINK_API_URL
    ?? "http://localhost:3003";
  const forwarded = new Headers({ Accept: "application/json" });
  for (const name of ["cookie", "authorization", "x-medlink-tenant-id"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const response = await fetch(new URL(`/api/v1/access-reviews/${encodeURIComponent(id)}`, origin), {
    cache: "no-store",
    headers: forwarded,
  });
  if (!response.ok) throw new Error("Medication-access review request failed");
  return (await response.json() as { data: AccessReviewDetail }).data;
}
