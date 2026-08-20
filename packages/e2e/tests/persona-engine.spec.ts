import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures/certification-test";
import type { PersonaCertificationFixture } from "../personas/factory";
import { personaMatrix, type PersonaName } from "../personas/matrix";

const supabaseUrl = process.env.MEDLINK_E2E_SUPABASE_URL ?? "";
const serviceKey = process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY ?? "";
const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const pharmacyUrl = process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002";
const pharmacistUrl = process.env.MEDLINK_E2E_PHARMACIST_URL ?? "http://localhost:3003";

async function loadFixture(): Promise<PersonaCertificationFixture> {
  return JSON.parse(await readFile(new URL("../.persona-fixture.json", import.meta.url), "utf8"));
}

test("MED-CERT-001 persona factory persists canonical identity, tenant, and RBAC preconditions", async () => {
  const fixture = await loadFixture();
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  expect(fixture.runId).toMatch(/^MEDLINK-E2E-\d{8}-/);
  for (const name of Object.keys(personaMatrix) as PersonaName[]) {
    const persona = fixture.personas[name];
    const { data: profile, error: profileError } = await service.from("user_profiles")
      .select("display_name").eq("id", persona.userId).single();
    expect(profileError, `${name}: ${JSON.stringify(profileError)}`).toBeNull();
    expect(profile?.display_name).toBe(persona.sentinel);
    const { data: memberships, error: membershipError } = await service.from("organization_memberships")
      .select("organization_id,role").eq("user_id", persona.userId).is("deleted_at", null);
    expect(membershipError, `${name}: ${JSON.stringify(membershipError)}`).toBeNull();
    if (personaMatrix[name].membershipRole) {
      expect(memberships).toEqual([{
        organization_id: fixture.organizationId,
        role: personaMatrix[name].membershipRole,
      }]);
    } else {
      expect(memberships).toEqual([]);
    }
  }
});

test("MED-SEC-001 anonymous direct API bypass is denied on persona-critical resources", async ({ request }) => {
  const probes = [
    `${patientUrl}/api/v1/reservations`,
    `${patientUrl}/api/v1/prescriptions`,
    `${pharmacyUrl}/api/v1/inventory`,
    `${pharmacistUrl}/api/v1/review`,
  ];
  for (const url of probes) {
    const response = await request.get(url);
    expect(response.status(), `${url}: ${await response.text()}`).toBe(401);
  }
});
