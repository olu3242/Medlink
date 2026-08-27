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
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const domainPattern = /^(?!.*\*)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const required = (env, name) => {
  const configured = value(env, name);
  if (!configured) throw new Error(`${name} is required`);
  return configured;
};

export function resolvePersonaConfiguration(env = process.env) {
  const profileName = value(env, "MEDLINK_TEST_PERSONA_PROFILE") ?? "core";
  const selectedRoles = personaProfiles[profileName];
  if (!selectedRoles) throw new Error(`Unknown persona profile: ${profileName}`);

  const configuredDomain = value(env, "MEDLINK_TEST_EMAIL_DOMAIN")?.toLowerCase();
  if (configuredDomain && !domainPattern.test(configuredDomain)) {
    throw new Error("MEDLINK_TEST_EMAIL_DOMAIN must be an exact valid domain without wildcards");
  }
  const configuredAllowlist = value(env, "MEDLINK_TEST_ALLOWED_EMAILS");
  const allowedEmails = configuredAllowlist === undefined
    ? new Set()
    : parseAllowedEmails(configuredAllowlist);
  if (!configuredDomain && allowedEmails.size === 0) {
    throw new Error("MEDLINK_TEST_EMAIL_DOMAIN or MEDLINK_TEST_ALLOWED_EMAILS is required");
  }
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
    if (!emailPattern.test(email)) throw new Error(`${emailName} must be a valid email address`);
    const domainApproved = configuredDomain !== undefined && email.split("@").at(-1) === configuredDomain;
    const allowlistApproved = allowedEmails.has(email);
    if (!domainApproved && !allowlistApproved) {
      throw new Error(`${emailName} is not approved by the configured test email controls`);
    }
    const organizationId = required(env, organizationName);
    if (!uuidPattern.test(organizationId)) throw new Error(`${organizationName} must be a UUID`);
    personas.push({ role, email, password: required(env, passwordName), organizationId });
  }

  return {
    profileName,
    domain: configuredDomain,
    allowedEmails,
    url: required(env, "MEDLINK_TEST_SUPABASE_URL"),
    serviceKey: required(env, "MEDLINK_TEST_SUPABASE_SERVICE_KEY"),
    personas,
  };
}

function parseAllowedEmails(configured) {
  const entries = configured.split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new Error("MEDLINK_TEST_ALLOWED_EMAILS must not be empty or contain empty entries");
  }
  if (entries.some((entry) => !emailPattern.test(entry))) {
    throw new Error("MEDLINK_TEST_ALLOWED_EMAILS contains a malformed email address");
  }
  const allowedEmails = new Set(entries);
  if (allowedEmails.size !== entries.length) {
    throw new Error("MEDLINK_TEST_ALLOWED_EMAILS contains duplicate normalized entries");
  }
  return allowedEmails;
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

async function validateOrganizations(service, personas, log) {
  const checked = new Map();
  for (const { role, organizationId } of personas) {
    if (checked.has(organizationId)) {
      if (!checked.get(organizationId)) {
        log(`PERSONA=${role} STATUS=BLOCKED_INVALID_ORGANIZATION`);
        throw new Error(`PERSONA=${role} STATUS=BLOCKED_INVALID_ORGANIZATION`);
      }
      continue;
    }
    const result = await service.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (result.error) throw result.error;
    checked.set(organizationId, Boolean(result.data));
    if (!result.data) {
      log(`PERSONA=${role} STATUS=BLOCKED_INVALID_ORGANIZATION`);
      throw new Error(`PERSONA=${role} STATUS=BLOCKED_INVALID_ORGANIZATION`);
    }
  }
}

export async function provisionTestPersonas({ env = process.env, createService, log = console.log } = {}) {
  const configuration = resolvePersonaConfiguration(env);
  const service = createService
    ? createService(configuration.url, configuration.serviceKey)
    : createClient(configuration.url, configuration.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await validateOrganizations(service, configuration.personas, log);

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
