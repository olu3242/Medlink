export type MedicineStatus = "draft" | "active" | "retired";

export interface MedicineSummary {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  normalizedStrength: string;
  dosageForm: string;
  route: string;
  manufacturer: string | null;
  controlled: boolean;
  status: MedicineStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MedicineDetail extends MedicineSummary {
  therapeuticClassId: string | null;
  therapeuticClass: string | null;
  packSize: string | null;
  aliases: Array<{ id: string; alias: string; locale: string }>;
  ingredients: Array<{
    ingredientId: string;
    preferredName: string;
    amount: number | null;
    unit: string | null;
    primary: boolean;
  }>;
  registrations: Array<{
    id: string;
    countryCode: string;
    authorityCode: string;
    registrationNumber: string;
    validFrom: string | null;
    validUntil: string | null;
  }>;
}

export interface CatalogFilters {
  query?: string | undefined;
  status?: MedicineStatus | undefined;
}

interface ApiList<T> {
  data: T[];
  meta?: { total?: number };
}

const apiOrigin = process.env.MEDLINK_API_URL ?? "http://localhost:3000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const incoming = await requestHeaders();
  const response = await fetch(new URL(path, apiOrigin), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(incoming.get("authorization")
        ? { Authorization: incoming.get("authorization")! }
        : {}),
      ...(incoming.get("cookie")
        ? { Cookie: incoming.get("cookie")! }
        : {}),
      ...(incoming.get("x-medlink-tenant-id")
        ? {
          "X-MedLink-Tenant-Id":
            incoming.get("x-medlink-tenant-id")!,
        }
        : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`MedLink API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function listMedicines(filters: CatalogFilters): Promise<ApiList<MedicineSummary>> {
  const query = new URLSearchParams();
  if (filters.query) query.set("q", filters.query);
  if (filters.status) query.set("status", filters.status);
  return apiFetch<ApiList<MedicineSummary>>(`/api/v1/medicines?${query.toString()}`);
}

export async function getMedicine(id: string): Promise<MedicineDetail> {
  const response = await apiFetch<{ data: MedicineDetail }>(
    `/api/v1/medicines/${encodeURIComponent(id)}`,
  );
  return response.data;
}

export interface DashboardMetric {
  id: string;
  label: string;
  value: number;
  status: "healthy" | "attention" | "empty" | "unknown";
  href: string;
}

export interface PlatformDashboardResponse {
  data: {
    generatedAt: string;
    authorization: { role: string; organizationId: string; actorId: string; subjectId: string; testAsAvailable: false };
    metrics: DashboardMetric[];
    workQueue: Array<{ severity: string; title: string; reason: string; href: string }>;
  };
}

export function getPlatformDashboard(): Promise<PlatformDashboardResponse> {
  return apiFetch<PlatformDashboardResponse>("/api/v1/dashboard/platform");
}

export interface DashboardSectionResponse {
  data: {
    generatedAt: string;
    metrics?: DashboardMetric[];
    organizations?: Array<{ id: string; name: string; type: string; created_at: string }>;
    emptyState?: string | null;
    manufacturerCoverage?: { total: number; present: number; missing: number; percent: number };
    nafdacCoverage?: { total: number; present: number; missing: number; percent: number };
    priceAccess?: Record<string, unknown>;
  };
}

export function getDashboardSection(section: "organizations" | "catalog" | "pharmacies" | "inventory", query = ""): Promise<DashboardSectionResponse> {
  return apiFetch<DashboardSectionResponse>(`/api/v1/dashboard/${section}${query ? `?${query}` : ""}`);
}
import { headers as requestHeaders } from "next/headers";
