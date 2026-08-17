import { createClient } from "@supabase/supabase-js";

export interface GoldenLoopPersona {
  readonly email: string;
  readonly userId: string;
}

export interface GoldenLoopFixture {
  readonly organizationId: string;
  readonly pharmacyLocationId: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly inventoryBatchId: string;
  readonly marId: string;
  readonly reviewId: string;
  readonly patient: GoldenLoopPersona;
  readonly pharmacist: GoldenLoopPersona;
  readonly pharmacyStaff: GoldenLoopPersona;
}

// Provisions three real, magic-link-addressable Supabase identities plus
// one canonical medicine/MAR/inventory-batch scenario (via the
// certify_medication_golden_loop_fixture RPC -- see
// supabase/migrations/202608170041_medication_golden_loop_live_fixture.sql).
// The MAR stops at 'validated' with a pending review. Review, match,
// reserve, confirm, ready, credential, and collect are all driven by the
// authenticated browser sessions through the real applications.
export async function provisionGoldenLoopFixture(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<GoldenLoopFixture> {
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  async function createPersona(label: string): Promise<GoldenLoopPersona> {
    const email = `golden-loop-${label}-${nonce}@medlink.test`;
    const created = await service.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`could not create persona "${label}"`);
    }
    return { email, userId: created.data.user.id };
  }

  const [patient, pharmacist, pharmacyStaff] = await Promise.all([
    createPersona("patient"),
    createPersona("pharmacist"),
    createPersona("pharmacy-staff"),
  ]);

  const { data, error } = await service.rpc("certify_medication_golden_loop_fixture", {
    fixture_key: nonce,
    patient_id: patient.userId,
    pharmacist_id: pharmacist.userId,
    pharmacy_staff_id: pharmacyStaff.userId,
  });
  if (error || !data) throw error ?? new Error("golden-loop fixture RPC returned no data");

  const scenario = data as {
    organizationId: string;
    pharmacyLocationId: string;
    medicineId: string;
    medicineName: string;
    inventoryBatchId: string;
    marId: string;
    reviewId: string;
  };

  return { ...scenario, patient, pharmacist, pharmacyStaff };
}
