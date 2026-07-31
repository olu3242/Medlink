export type OrganizationType =
  | "hospital" | "clinic" | "pharmacy" | "hmo"
  | "manufacturer" | "distributor" | "ngo" | "government";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
