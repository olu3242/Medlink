import { RuntimeError } from "@medlink/runtime";
import { z } from "zod";

export const pharmacyLocationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  locality: z.string().nullable(),
  active: z.boolean(),
}).strict();

export type PharmacyLocationSummary = z.infer<
  typeof pharmacyLocationSummarySchema
>;

export interface PharmacyLocationRepository {
  listActive(organizationId: string): Promise<
    readonly PharmacyLocationSummary[]
  >;
}

export class PharmacyLocationDirectory {
  constructor(private readonly repository: PharmacyLocationRepository) {}

  listActive(organizationId: string) {
    return this.repository.listActive(z.string().uuid().parse(organizationId));
  }
}

export class PharmacyLocationReadError extends RuntimeError {
  constructor(cause?: unknown) {
    super(
      "infrastructure",
      "pharmacy_locations_failed",
      "Pharmacy locations could not be loaded",
      503,
      true,
      "Retry later.",
      { cause },
    );
    this.name = "PharmacyLocationReadError";
  }
}
