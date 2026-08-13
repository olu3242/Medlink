import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const pharmacistDashboardSchema = z.object({
  pendingReviews: z.number().int().min(0),
  needsInformation: z.number().int().min(0),
  approvedTodayUtc: z.number().int().min(0),
  rejectedTodayUtc: z.number().int().min(0),
  unresolvedMedicines: z.number().int().min(0),
  recentActivity: z.array(z.object({
    reviewId: z.string().uuid(),
    prescriptionId: z.string().uuid(),
    status: z.enum(["pending", "approved", "rejected", "needs_information"]),
    occurredAt: z.string(),
  }).strict()),
}).strict();

export type PharmacistDashboard = z.infer<typeof pharmacistDashboardSchema>;

interface CountResult {
  count: number | null;
  error: unknown;
}

export class SupabasePharmacistDashboard {
  constructor(private readonly database: SupabaseClient) {}

  async get(organizationId: string): Promise<PharmacistDashboard> {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const pendingRows = await this.database.from("clinical_validations")
      .select("id,prescription_id,status,reviewed_at,created_at")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100);
    if (pendingRows.error) throw this.failure(pendingRows.error);
    const pendingPrescriptionIds = (pendingRows.data ?? []).map(
      ({ prescription_id }) => prescription_id as string,
    );
    const requests = await Promise.all([
      this.count("needs_information", organizationId),
      this.count("approved", organizationId, day.toISOString()),
      this.count("rejected", organizationId, day.toISOString()),
      this.database.from("clinical_validations")
        .select("id,prescription_id,status,reviewed_at,created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(8),
      pendingPrescriptionIds.length
        ? this.database.from("prescription_items")
          .select("id", { count: "exact", head: true })
          .in("prescription_id", pendingPrescriptionIds)
          .is("medicine_id", null)
        : Promise.resolve({ count: 0, error: null }),
    ]);
    const [needs, approved, rejected, activity, unresolved] = requests;
    if (activity.error) throw this.failure(activity.error);
    if (unresolved.error) throw this.failure(unresolved.error);
    return pharmacistDashboardSchema.parse({
      pendingReviews: pendingRows.data?.length ?? 0,
      needsInformation: needs,
      approvedTodayUtc: approved,
      rejectedTodayUtc: rejected,
      unresolvedMedicines: unresolved.count ?? 0,
      recentActivity: (activity.data ?? []).map((row) => ({
        reviewId: row.id,
        prescriptionId: row.prescription_id,
        status: row.status,
        occurredAt: row.reviewed_at ?? row.created_at,
      })),
    });
  }

  private async count(
    status: "approved" | "rejected" | "needs_information",
    organizationId: string,
    reviewedSince?: string,
  ) {
    let query = this.database.from("clinical_validations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", status);
    if (reviewedSince) query = query.gte("reviewed_at", reviewedSince);
    const result = await query as CountResult;
    if (result.error) throw this.failure(result.error);
    return result.count ?? 0;
  }

  private failure(cause: unknown) {
    return new RuntimeError(
      "infrastructure",
      "pharmacist_dashboard_failed",
      "The pharmacist dashboard could not be loaded",
      503,
      true,
      "Retry later.",
      { cause },
    );
  }
}
