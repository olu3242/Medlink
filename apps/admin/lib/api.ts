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

function getApiOrigin() {
  const configured = process.env.MEDLINK_API_URL;
  if (configured) return configured;
  if (process.env.VERCEL === "1") {
    throw new Error("MEDLINK_API_URL is required in hosted admin runtime");
  }
  return "http://localhost:3000";
}

function getAdminOrigin() {
  const configured = process.env.MEDLINK_ADMIN_URL;
  if (configured) return configured;
  if (process.env.VERCEL === "1") {
    throw new Error("MEDLINK_ADMIN_URL is required for hosted Control Center runtime");
  }
  return "http://localhost:3001";
}

function safeErrorClass(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

async function apiFetch<T>(path: string, init?: RequestInit, origin = getApiOrigin()): Promise<T> {
  const incoming = await requestHeaders();
  const requestId = incoming.get("x-request-id") ?? crypto.randomUUID();
  const correlationId = incoming.get("x-correlation-id") ?? requestId;
  let upstream: URL | undefined;
  try {
    upstream = new URL(path, origin);
    const response = await fetch(upstream, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Request-Id": requestId,
        "X-Correlation-Id": correlationId,
        ...(incoming.get("authorization")
          ? { Authorization: incoming.get("authorization")! }
          : {}),
        ...(incoming.get("cookie")
          ? { Cookie: incoming.get("cookie")! }
          : {}),
        ...(incoming.get("x-medlink-tenant-id")
          ? { "X-MedLink-Tenant-Id": incoming.get("x-medlink-tenant-id")! }
          : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`MedLink API request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    console.error(JSON.stringify({
      portal: "admin",
      route: upstream?.pathname ?? path.split("?")[0],
      upstream: upstream?.origin ?? "unconfigured",
      status: error instanceof Error && /\((\d{3})\)/.test(error.message)
        ? Number(error.message.match(/\((\d{3})\)/)?.[1])
        : null,
      request_id: requestId,
      correlation_id: correlationId,
      error_class: safeErrorClass(error),
    }));
    throw error;
  }
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
    metricScope: string;
  };
}

export function getPlatformDashboard(): Promise<PlatformDashboardResponse> {
  return apiFetch<PlatformDashboardResponse>("/api/v1/dashboard/platform", undefined, getAdminOrigin());
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

export function getDashboardSection(section: "organizations" | "catalog" | "pharmacies" | "inventory" | "reservations", query = ""): Promise<DashboardSectionResponse> {
  return apiFetch<DashboardSectionResponse>(
    `/api/v1/dashboard/${section}${query ? `?${query}` : ""}`,
    undefined,
    getAdminOrigin(),
  );
}
import { headers as requestHeaders } from "next/headers";
