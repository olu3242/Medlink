import { createClient } from "@supabase/supabase-js";

export interface GoldenLoopPersona {
  readonly email: string;
  readonly userId: string;
}

export interface GoldenLoopFixture {
  readonly organizationId: string;
  readonly isolationOrganizationId: string;
  readonly pharmacyLocationId: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly inventoryBatchId: string;
  readonly whatsappPhoneNumberId: string;
  readonly whatsappChannelIdentity: string;
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

  const { error: searchProjectionError } = await service.rpc(
    "certify_golden_loop_search_projection",
    { target_medicine_id: scenario.medicineId, fixture_key: nonce },
  );
  if (searchProjectionError) throw searchProjectionError;

  // Clinical evidence is deliberately hidden from an ordinary pharmacist.
  // Provision the licensed identity that the real review RLS and decision RPC
  // require; the browser still has to authenticate and perform the decision.
  const { error: pharmacistProfileError } = await service.rpc(
    "certify_golden_loop_pharmacist_profile",
    {
      target_organization_id: scenario.organizationId,
      target_pharmacist_id: pharmacist.userId,
      target_license_number: `PCN-${nonce}`,
    },
  );
  if (pharmacistProfileError) throw pharmacistProfileError;

  const whatsappPhoneNumberId = `phone-${nonce}`;
  const whatsappChannelIdentity = `sender-${nonce}`;
  const { error: whatsappIdentityError } = await service.rpc(
    "certify_whatsapp_golden_loop_identity",
    {
      target_organization_id: scenario.organizationId,
      target_patient_id: patient.userId,
      target_verified_by: pharmacist.userId,
      target_phone_number_id: whatsappPhoneNumberId,
      target_channel_identity: whatsappChannelIdentity,
    },
  );
  if (whatsappIdentityError) throw whatsappIdentityError;

  const isolationOrganizationId = crypto.randomUUID();
  const { error: isolationOrganizationError } = await service.from("organizations").insert({
    id: isolationOrganizationId,
    name: `Golden Loop Isolation ${nonce}`,
    slug: `golden-loop-isolation-${nonce}`,
    type: "pharmacy",
  });
  if (isolationOrganizationError) throw isolationOrganizationError;

  return {
    ...scenario,
    isolationOrganizationId,
    whatsappPhoneNumberId,
    whatsappChannelIdentity,
    patient,
    pharmacist,
    pharmacyStaff,
  };
}
