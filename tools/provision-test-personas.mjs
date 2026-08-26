import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const personaDefinitions = [
  ["platform_admin", "MEDLINK_TEST_PLATFORM_ADMIN_EMAIL", "MEDLINK_TEST_PLATFORM_ADMIN_PASSWORD", "MEDLINK_TEST_PLATFORM_ADMIN_ORGANIZATION_ID"],
  ["tenant_admin", "MEDLINK_TEST_TENANT_ADMIN_EMAIL", "MEDLINK_TEST_TENANT_ADMIN_PASSWORD", "MEDLINK_TEST_TENANT_ADMIN_ORGANIZATION_ID"],
  ["patient", "MEDLINK_TEST_PATIENT_EMAIL", "MEDLINK_TEST_PATIENT_PASSWORD", "MEDLINK_TEST_PATIENT_ORGANIZATION_ID"],
  ["pharmacist", "MEDLINK_TEST_PHARMACIST_EMAIL", "MEDLINK_TEST_PHARMACIST_PASSWORD", "MEDLINK_TEST_PHARMACIST_ORGANIZATION_ID"],
  ["pharmacy_owner", "MEDLINK_TEST_PHARMACY_OWNER_EMAIL", "MEDLINK_TEST_PHARMACY_OWNER_PASSWORD", "MEDLINK_TEST_PHARMACY_OWNER_ORGANIZATION_ID"],
  ["pharmacy_staff", "MEDLINK_TEST_PHARMACY_STAFF_EMAIL", "MEDLINK_TEST_PHARMACY_STAFF_PASSWORD", "MEDLINK_TEST_PHARMACY_STAFF_ORGANIZATION_ID"],
  ["inventory_manager", "MEDLINK_TEST_INVENTORY_MANAGER_EMAIL", "MEDLINK_TEST_INVENTORY_MANAGER_PASSWORD", "MEDLINK_TEST_INVENTORY_MANAGER_ORGANIZATION_ID"],
  ["provider", "MEDLINK_TEST_PROVIDER_EMAIL", "MEDLINK_TEST_PROVIDER_PASSWORD", "MEDLINK_TEST_PROVIDER_ORGANIZATION_ID"],
];

export const personaProfiles = {
  core: ["platform_admin", "patient", "pharmacist", "pharmacy_owner"],
  expanded: ["platform_admin", "patient", "pharmacist", "pharmacy_owner", "tenant_admin", "inventory_manager"],
  full: personaDefinitions.map(([role]) => role),
};

const value = (env, name) => env[name]?.trim();

const required = (env, name) => {
  const configured = value(env, name);
  if (!configured) throw new Error(`${name} is required`);
  return configured;
};

export function resolvePersonaConfiguration(env = process.env) {
  const profileName = value(env, "MEDLINK_TEST_PERSONA_PROFILE") ?? "core";
  const selectedRoles = personaProfiles[profileName];
  if (!selectedRoles) throw new Error(`Unknown persona profile: ${profileName}`);

  const domain = required(env, "MEDLINK_TEST_EMAIL_DOMAIN").toLowerCase();
  const selected = new Set(selectedRoles);
  const personas = [];

  for (const [role, emailName, passwordName, organizationName] of personaDefinitions) {
    const names = [emailName, passwordName, organizationName];
    const present = names.filter((name) => Boolean(value(env, name)));
    if (present.length > 0 && present.length < names.length) {
      throw new Error(`${role} must configure EMAIL, PASSWORD, and ORGANIZATION_ID together`);
    }
    if (!selected.has(role)) continue;
    if (present.length === 0) throw new Error(`${role} is required by the ${profileName} persona profile`);

    const email = required(env, emailName).toLowerCase();
    if (email.split("@").at(-1) !== domain) {
      throw new Error(`${emailName} must use MEDLINK_TEST_EMAIL_DOMAIN`);
    }
    personas.push({ role, email, password: required(env, passwordName), organizationId: required(env, organizationName) });
  }

  return {
    profileName,
    domain,
    url: required(env, "MEDLINK_TEST_SUPABASE_URL"),
    serviceKey: required(env, "MEDLINK_TEST_SUPABASE_SERVICE_KEY"),
    personas,
  };
}

async function findUser(service, email) {
  for (let page = 1; ; page += 1) {
    const result = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    const found = result.data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (result.data.users.length < 1000) return undefined;
  }
}

async function validateOrganizations(service, personas) {
  for (const organizationId of new Set(personas.map(({ organizationId }) => organizationId))) {
    const result = await service.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Configured test organization does not exist");
  }
}

export async function provisionTestPersonas({ env = process.env, createService, log = console.log } = {}) {
  const configuration = resolvePersonaConfiguration(env);
  const service = createService
    ? createService(configuration.url, configuration.serviceKey)
    : createClient(configuration.url, configuration.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await validateOrganizations(service, configuration.personas);

  for (const { role, email, password, organizationId } of configuration.personas) {
    let user = await findUser(service, email);
    const userStatus = user ? "REUSED" : "CREATED";
    if (!user) {
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { medlink_test_identity: true },
      });
      if (created.error || !created.data.user) throw created.error ?? new Error(`Could not create ${role}`);
      user = created.data.user;
    }
    const profile = await service.from("user_profiles").upsert(
      { id: user.id, display_name: `MedLink Test ${role.replaceAll("_", " ")}` },
      { onConflict: "id" },
    );
    if (profile.error) throw profile.error;
    const membership = await service.from("organization_memberships").upsert(
      { organization_id: organizationId, user_id: user.id, role, deleted_at: null },
      { onConflict: "organization_id,user_id" },
    );
    if (membership.error) throw membership.error;
    log(`PERSONA=${role} USER=${userStatus} PROFILE=PASS MEMBERSHIP=PASS ROLE=${role}`);
  }

  return { profileName: configuration.profileName, provisioned: configuration.personas.length };
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) await provisionTestPersonas();
