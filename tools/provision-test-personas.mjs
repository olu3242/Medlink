import { createClient } from "@supabase/supabase-js";

const definitions = [
  ["platform_admin", "MEDLINK_TEST_PLATFORM_ADMIN_EMAIL", "MEDLINK_TEST_PLATFORM_ADMIN_PASSWORD", "MEDLINK_TEST_PLATFORM_ADMIN_ORGANIZATION_ID"],
  ["tenant_admin", "MEDLINK_TEST_TENANT_ADMIN_EMAIL", "MEDLINK_TEST_TENANT_ADMIN_PASSWORD", "MEDLINK_TEST_TENANT_ADMIN_ORGANIZATION_ID"],
  ["patient", "MEDLINK_TEST_PATIENT_EMAIL", "MEDLINK_TEST_PATIENT_PASSWORD", "MEDLINK_TEST_PATIENT_ORGANIZATION_ID"],
  ["pharmacist", "MEDLINK_TEST_PHARMACIST_EMAIL", "MEDLINK_TEST_PHARMACIST_PASSWORD", "MEDLINK_TEST_PHARMACIST_ORGANIZATION_ID"],
  ["pharmacy_owner", "MEDLINK_TEST_PHARMACY_OWNER_EMAIL", "MEDLINK_TEST_PHARMACY_OWNER_PASSWORD", "MEDLINK_TEST_PHARMACY_OWNER_ORGANIZATION_ID"],
  ["pharmacy_staff", "MEDLINK_TEST_PHARMACY_STAFF_EMAIL", "MEDLINK_TEST_PHARMACY_STAFF_PASSWORD", "MEDLINK_TEST_PHARMACY_STAFF_ORGANIZATION_ID"],
  ["inventory_manager", "MEDLINK_TEST_INVENTORY_MANAGER_EMAIL", "MEDLINK_TEST_INVENTORY_MANAGER_PASSWORD", "MEDLINK_TEST_INVENTORY_MANAGER_ORGANIZATION_ID"],
  ["provider", "MEDLINK_TEST_PROVIDER_EMAIL", "MEDLINK_TEST_PROVIDER_PASSWORD", "MEDLINK_TEST_PROVIDER_ORGANIZATION_ID"],
];

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const domain = required("MEDLINK_TEST_EMAIL_DOMAIN").toLowerCase();
const url = required("MEDLINK_TEST_SUPABASE_URL");
const serviceKey = required("MEDLINK_TEST_SUPABASE_SERVICE_KEY");
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email) {
  for (let page = 1; ; page += 1) {
    const result = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (result.data.users.length < 1000) return undefined;
  }
}

for (const [role, emailName, passwordName, organizationName] of definitions) {
  const email = required(emailName).toLowerCase();
  if (email.split("@").at(-1) !== domain) throw new Error(`${emailName} must use MEDLINK_TEST_EMAIL_DOMAIN`);
  const password = required(passwordName);
  const organizationId = required(organizationName);
  let user = await findUser(email);
  if (!user) {
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { medlink_test_identity: true } });
    if (created.error || !created.data.user) throw created.error ?? new Error(`Could not create ${role}`);
    user = created.data.user;
  }
  const profile = await service.from("user_profiles").upsert({ id: user.id, display_name: `MedLink Test ${role.replaceAll("_", " ")}` }, { onConflict: "id" });
  if (profile.error) throw profile.error;
  const membership = await service.from("organization_memberships").upsert({ organization_id: organizationId, user_id: user.id, role, deleted_at: null }, { onConflict: "organization_id,user_id" });
  if (membership.error) throw membership.error;
  console.log(`PERSONA=${role} USER=EXISTS PROFILE=PASS MEMBERSHIP=PASS ROLE=${role}`);
}
