import { createClient } from "@supabase/supabase-js";

export interface AuthE2EPersona {
  readonly email: string;
  readonly userId: string;
}

export interface AuthE2EFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly patient: AuthE2EPersona;
  readonly pharmacist: AuthE2EPersona;
  readonly pharmacyStaff: AuthE2EPersona;
  readonly pharmacyOwner: AuthE2EPersona;
  readonly otherTenantPharmacist: AuthE2EPersona;
  readonly multiPersona: AuthE2EPersona;
  readonly partnerApplicant: AuthE2EPersona;
  readonly partnerReviewer: AuthE2EPersona;
}

// Deterministic tenant + one real, magic-link-addressable identity per
// persona -- the smallest fixture this slice needs (Section 15's
// "who is acting" gate). It does not seed medicine/MAR/reservation data;
// that belongs to the next slice's full golden-loop certification, which
// proves "what they can do" against real business data. Reuses the
// same organizations/user_profiles/organization_memberships tables and
// shapes every other fixture in this repository already writes -- no
// new identity or membership model.
export async function provisionAuthE2EFixture(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<AuthE2EFixture> {
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  async function createPersona(label: string): Promise<AuthE2EPersona> {
    const email = `auth-e2e-${label}-${nonce}@medlink.test`;
    const created = await service.auth.admin.createUser({ email, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`could not create persona "${label}"`);
    }
    return { email, userId: created.data.user.id };
  }

  const [patient, pharmacist, pharmacyStaff, pharmacyOwner, otherTenantPharmacist, multiPersona, partnerApplicant, partnerReviewer] = await Promise.all([
    createPersona("patient"),
    createPersona("pharmacist"),
    createPersona("pharmacy-staff"),
    createPersona("pharmacy-owner"),
    createPersona("other-tenant-pharmacist"),
    // Same person holding two legitimate roles in the same organization
    // -- one identity, multiple memberships (Section 14).
    createPersona("multi-persona"),
    createPersona("partner-applicant"),
    createPersona("partner-reviewer"),
  ]);

  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();

  const { error: organizationsError } = await service.from("organizations").insert([
    { id: organizationId, name: `Auth E2E ${nonce}`, slug: `auth-e2e-${nonce}`, type: "pharmacy" },
    {
      id: otherOrganizationId,
      name: `Auth E2E Other ${nonce}`,
      slug: `auth-e2e-other-${nonce}`,
      type: "pharmacy",
    },
  ]);
  if (organizationsError) throw organizationsError;

  const { error: profilesError } = await service.from("user_profiles").insert([
    { id: patient.userId, display_name: "E2E Patient" },
    { id: pharmacist.userId, display_name: "E2E Pharmacist" },
    { id: pharmacyStaff.userId, display_name: "E2E Pharmacy Staff" },
    { id: pharmacyOwner.userId, display_name: "E2E Pharmacy Manager" },
    { id: otherTenantPharmacist.userId, display_name: "E2E Other Tenant Pharmacist" },
    { id: multiPersona.userId, display_name: "E2E Multi Persona" },
    { id: partnerApplicant.userId, display_name: "E2E Partner Applicant" },
    { id: partnerReviewer.userId, display_name: "E2E Partner Reviewer" },
  ]);
  if (profilesError) throw profilesError;

  // organization_memberships has a unique (organization_id, user_id)
  // constraint -- one role per org per user. The multi-context case this
  // schema actually supports is the same identity holding memberships
  // in two *different* organizations, not two roles within one, so
  // multiPersona is a pharmacist in the primary org and pharmacy staff
  // in the other -- two legitimate, genuinely ambiguous contexts an
  // explicit x-medlink-tenant-id header must choose between.
  const { error: membershipsError } = await service.from("organization_memberships").insert([
    { organization_id: organizationId, user_id: patient.userId, role: "patient" },
    { organization_id: organizationId, user_id: pharmacist.userId, role: "pharmacist" },
    { organization_id: organizationId, user_id: pharmacyStaff.userId, role: "pharmacy_staff" },
    { organization_id: organizationId, user_id: pharmacyOwner.userId, role: "pharmacy_owner" },
    { organization_id: otherOrganizationId, user_id: otherTenantPharmacist.userId, role: "pharmacist" },
    { organization_id: organizationId, user_id: multiPersona.userId, role: "pharmacist" },
    { organization_id: otherOrganizationId, user_id: multiPersona.userId, role: "pharmacy_staff" },
    { organization_id: organizationId, user_id: partnerReviewer.userId, role: "platform_admin" },
  ]);
  if (membershipsError) throw membershipsError;

  return { organizationId, otherOrganizationId, patient, pharmacist, pharmacyStaff, pharmacyOwner, otherTenantPharmacist, multiPersona, partnerApplicant, partnerReviewer };
}
