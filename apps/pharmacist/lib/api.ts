import type {
  PharmacistDashboard,
  PharmacistReviewDetail,
  PharmacistReviewSummary,
} from "@medlink/clinical";
import type { InventoryBatch } from "@medlink/inventory";
import { headers } from "next/headers";

export type Review = PharmacistReviewSummary;
export type ReviewDetail = PharmacistReviewDetail;

async function get<T>(path: string) {
  const incoming = await headers();
  const origin = process.env.MEDLINK_PHARMACIST_URL
    ?? process.env.MEDLINK_API_URL
    ?? "http://localhost:3003";
  const forwarded = new Headers({ Accept: "application/json" });
  for (const name of ["cookie", "authorization", "x-medlink-tenant-id"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const response = await fetch(new URL(path, origin), {
    cache: "no-store",
    headers: forwarded,
  });
  if (!response.ok) throw new Error("Review request failed");
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
