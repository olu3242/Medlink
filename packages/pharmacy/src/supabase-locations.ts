import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  PharmacyLocationReadError,
  pharmacyLocationSummarySchema,
  type PharmacyLocationRepository,
} from "./locations";

const rowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  locality: z.string().nullable(),
  is_active: z.boolean(),
});

export class SupabasePharmacyLocationRepository
implements PharmacyLocationRepository {
  constructor(private readonly database: SupabaseClient) {}

  async listActive(organizationId: string) {
    const { data, error } = await this.database.from("pharmacy_locations")
      .select("id,name,locality,is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name");
    if (error) throw new PharmacyLocationReadError(error);
    return rowSchema.array().parse(data ?? []).map((location) =>
      pharmacyLocationSummarySchema.parse({
        id: location.id,
        name: location.name,
        locality: location.locality,
        active: location.is_active,
      }));
  }
}
