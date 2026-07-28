export type MedicineStatus = "active" | "inactive";

export interface MedicineSummary {
  id: string;
  name: string;
  genericName: string;
  brandName?: string;
  strength: string;
  dosageForm: string;
  status: MedicineStatus;
}

export interface MedicineDetail extends MedicineSummary {
  route?: string;
  therapeuticClass?: string;
  controlled: boolean;
  updatedAt?: string;
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
  const response = await fetch(new URL(path, apiOrigin), {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
    next: { revalidate: 30, ...init?.next },
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
