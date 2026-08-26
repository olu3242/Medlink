import { describe, expect, it, vi } from "vitest";
// @ts-expect-error -- native ESM command modules do not emit TypeScript declarations.
import { personaProfiles, provisionTestPersonas, resolvePersonaConfiguration } from "./provision-test-personas.mjs";

const triplets = {
  platform_admin: "PLATFORM_ADMIN",
  patient: "PATIENT",
  pharmacist: "PHARMACIST",
  pharmacy_owner: "PHARMACY_OWNER",
  tenant_admin: "TENANT_ADMIN",
  inventory_manager: "INVENTORY_MANAGER",
  pharmacy_staff: "PHARMACY_STAFF",
  provider: "PROVIDER",
};

function environment(profile = "core", roles: readonly string[] = personaProfiles[profile] ?? []) {
  const env: Record<string, string> = {
    MEDLINK_TEST_PERSONA_PROFILE: profile,
    MEDLINK_TEST_EMAIL_DOMAIN: "tests.medlink.example",
    MEDLINK_TEST_SUPABASE_URL: "https://test.supabase.example",
    MEDLINK_TEST_SUPABASE_SERVICE_KEY: "service-secret",
  };
  for (const role of roles) {
    const key = triplets[role as keyof typeof triplets];
    env[`MEDLINK_TEST_${key}_EMAIL`] = `${role}@tests.medlink.example`;
    env[`MEDLINK_TEST_${key}_PASSWORD`] = `${role}-secret`;
    env[`MEDLINK_TEST_${key}_ORGANIZATION_ID`] = `organization-${role}`;
  }
  return env;
}

function service() {
  const users: Array<{ id: string; email: string }> = [];
  const createUser = vi.fn(async ({ email }: { email: string }) => {
    const user = { id: `user-${email}`, email };
    users.push(user);
    return { data: { user }, error: null };
  });
  const upsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => {
    if (table === "organizations") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "organization" }, error: null }) }) }) };
    }
    return { upsert };
  });
  return {
    client: { auth: { admin: { listUsers: vi.fn(async () => ({ data: { users }, error: null })), createUser } }, from },
    createUser,
    upsert,
  };
}

describe("release-scoped persona provisioning", () => {
  it.each([["core", 4], ["expanded", 6], ["full", 8]])("selects the %s profile", (profile, count) => {
    expect(resolvePersonaConfiguration(environment(profile)).personas).toHaveLength(count);
  });

  it("does not require provider for core", () => {
    expect(resolvePersonaConfiguration(environment("core")).personas.map(({ role }) => role)).not.toContain("provider");
  });

  it("rejects a missing required persona", () => {
    const env = environment("core");
    delete env.MEDLINK_TEST_PATIENT_EMAIL;
    delete env.MEDLINK_TEST_PATIENT_PASSWORD;
    delete env.MEDLINK_TEST_PATIENT_ORGANIZATION_ID;
    expect(() => resolvePersonaConfiguration(env)).toThrow(/patient is required/);
  });

  it("skips an absent optional persona", () => {
    expect(resolvePersonaConfiguration(environment("core")).personas.map(({ role }) => role)).toEqual(personaProfiles.core);
  });

  it("rejects a partial optional credential triplet", () => {
    const env = environment("core");
    env.MEDLINK_TEST_PROVIDER_EMAIL = "provider@tests.medlink.example";
    expect(() => resolvePersonaConfiguration(env)).toThrow(/provider must configure EMAIL, PASSWORD, and ORGANIZATION_ID together/);
  });

  it("rejects an invalid email domain", () => {
    const env = environment("core");
    env.MEDLINK_TEST_PATIENT_EMAIL = "patient@outside.example";
    expect(() => resolvePersonaConfiguration(env)).toThrow(/MEDLINK_TEST_EMAIL_DOMAIN/);
  });

  it("rejects a missing organization", () => {
    const env = environment("core");
    delete env.MEDLINK_TEST_PATIENT_ORGANIZATION_ID;
    expect(() => resolvePersonaConfiguration(env)).toThrow(/configure EMAIL, PASSWORD, and ORGANIZATION_ID together/);
  });

  it("rejects an unknown persona profile", () => {
    expect(() => resolvePersonaConfiguration(environment("unknown", []))).toThrow(/Unknown persona profile/);
  });

  it("is idempotent and does not expose secrets in output", async () => {
    const env = environment("core");
    const mock = service();
    const messages: string[] = [];
    const options = { env, createService: () => mock.client, log: (message: string) => messages.push(message) };
    await provisionTestPersonas(options);
    await provisionTestPersonas(options);
    expect(mock.createUser).toHaveBeenCalledTimes(4);
    expect(mock.upsert).toHaveBeenCalledTimes(16);
    expect(messages.join("\n")).not.toContain("secret");
    expect(messages.join("\n")).not.toContain("@tests.medlink.example");
    expect(messages).toHaveLength(8);
  });

  it("fails before identity creation when an organization does not exist", async () => {
    const env = environment("core");
    const mock = service();
    mock.client.from = vi.fn((table: string) => table === "organizations"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      : { upsert: mock.upsert });
    await expect(provisionTestPersonas({ env, createService: () => mock.client, log: vi.fn() })).rejects.toThrow(/organization does not exist/);
    expect(mock.createUser).not.toHaveBeenCalled();
  });
});
