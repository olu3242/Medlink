import { cookies, headers } from "next/headers";
import type { AccessReviewDetail } from "./access-review-application";
import { resolveServerOrigin } from "@medlink/platform";

export async function accessReview(id: string): Promise<AccessReviewDetail> {
  const [incoming, cookieStore] = await Promise.all([headers(), cookies()]);
  const origin = resolveServerOrigin(
    ["MEDLINK_PUBLIC_ORIGIN", "MEDLINK_PHARMACIST_URL", "MEDLINK_API_URL"],
    "http://localhost:3003",
    "pharmacist access-review API calls",
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
  const response = await fetch(new URL(`/pharmacist/api/v1/access-reviews/${encodeURIComponent(id)}`, origin), {
    cache: "no-store",
    headers: forwarded,
  });
  if (!response.ok) throw new Error("Medication-access review request failed");
  return (await response.json() as { data: AccessReviewDetail }).data;
}
