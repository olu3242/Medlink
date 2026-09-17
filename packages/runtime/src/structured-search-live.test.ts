import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { prepareStructuredSearchFixture } from "../../e2e/lib/structured-search-fixture";
import { GET } from "../../../apps/patient/app/api/v1/medicines/equivalents/route";

const enabled = process.env.MEDLINK_CERTIFICATION_LOCAL === "true";
describe.skipIf(!enabled)("structured search through real authenticated database and API", () => {
  let fixture: Awaited<ReturnType<typeof prepareStructuredSearchFixture>>;
  const tokens = new Map<string, string>();
  beforeAll(async () => {
    fixture = await prepareStructuredSearchFixture();
    const service = createClient(process.env.MEDLINK_E2E_SUPABASE_URL!, process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
    for (const [role, user] of Object.entries(fixture.users)) {
      const link = await service.auth.admin.generateLink({ type: "magiclink", email: user.email });
      if (link.error) throw new Error("Synthetic sign-in link generation failed");
      const client = createClient(process.env.MEDLINK_E2E_SUPABASE_URL!, process.env.MEDLINK_E2E_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const session = await client.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
      if (!session.data.session) throw new Error("Synthetic sign-in failed");
      tokens.set(role, session.data.session.access_token);
    }
  });
  const request = (params: Record<string, string> = {}, role = "patient", tenant?: string) => GET(new Request(`http://localhost:3100/patient/api/v1/medicines/equivalents?${new URLSearchParams({ medicineId: fixture.products.reference!, ...params })}`, {
    headers: { authorization: `Bearer ${tokens.get(role)}`, "x-medlink-tenant-id": tenant ?? fixture.patientOrganizationId },
  }));
  it("groups actual normalized rows with source attribution and differing fields", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.source).toBe("INTERNAL_CATALOGUE");
    const ids = (group: string) => data.results.filter((item: { group: string }) => item.group === group).map((item: { medicine: { id: string } }) => item.medicine.id);
    expect(ids("exact")).toEqual(expect.arrayContaining([fixture.products.reference, fixture.products.exact, fixture.products.units, fixture.products.unavailable]));
    expect(ids("related")).toEqual(expect.arrayContaining([fixture.products.ratio, fixture.products.strength, fixture.products.form, fixture.products.route, fixture.products.incomplete, fixture.products.registration]));
    expect(ids("therapeutic")).toEqual([fixture.products.single]);
    expect(data.results.some((item: { medicine: { id: string } }) => item.medicine.id === fixture.products.inactive)).toBe(false);
    expect(data.results.find((item: { medicine: { id: string } }) => item.medicine.id === fixture.products.ratio).differences).toContain("ingredient amounts or ratios");
  });
  it("returns stock for the correct product/pharmacy, flags stale stock, and excludes it from in-stock", async () => {
    const nearby = { latitude: "6.5244", longitude: "3.3792", locationConsent: "true", brand: "CERT Combination" };
    const response = await request(nearby);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    const offers = data.results[0].offers;
    expect(offers).toHaveLength(3);
    expect(new Set(offers.map((item: { pharmacyLocationId: string }) => item.pharmacyLocationId)).size).toBe(3);
    expect(offers.filter((item: { freshness: string }) => item.freshness === "stale")).toHaveLength(1);
    expect(offers.every((item: { medicineId: string }) => item.medicineId === fixture.products.reference)).toBe(true);
    const fresh = await (await request({ ...nearby, availability: "in_stock" })).json();
    expect(fresh.data.results[0].offers).toHaveLength(2);
    const low = await (await request({ ...nearby, availability: "low_stock" })).json();
    expect(low.data.results[0].offers).toHaveLength(1);
  });
  it.each([
    [{ quality: "exact" }, "exact"], [{ form: "capsule" }, "related"], [{ route: "topical" }, "related"],
    [{ strength: "1000 mg + 125 mg" }, "related"], [{ quality: "therapeutic" }, "therapeutic"],
  ])("applies filter %j", async (filters, group) => {
    const response = await request(filters);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results.every((item: { group: string }) => item.group === group)).toBe(true);
  });
  it("uses stable pagination and combined filters", async () => {
    const first = await (await request({ limit: "2", sort: "brand" })).json();
    const second = await (await request({ limit: "2", offset: "2", sort: "brand" })).json();
    expect(new Set([...first.data.results, ...second.data.results].map((item: { medicine: { id: string } }) => item.medicine.id)).size).toBe(4);
    const filtered = await (await request({ quality: "exact", registered: "true", manufacturer: "CERT Manufacturer", brand: "CERT Equivalent" })).json();
    expect(filtered.data.results.map((item: { medicine: { id: string } }) => item.medicine.id)).toEqual([fixture.products.exact]);
  });
  it("rejects cross-organization context, nonpatients, malformed inputs and anonymous callers", async () => {
    expect((await request({}, "patient", fixture.pharmacyOrganizationId)).status).toBe(403);
    for (const role of ["pharmacist", "platform_admin", "pharmacy_staff"]) expect((await request({}, role, role === "pharmacy_staff" ? fixture.pharmacyOrganizationId : fixture.patientOrganizationId)).status).toBe(403);
    expect((await request({ limit: "5000" })).status).toBe(400);
    const anonymous = await GET(new Request(`http://localhost:3100/patient/api/v1/medicines/equivalents?medicineId=${fixture.products.reference}`));
    expect(anonymous.status).toBe(401);
  });
});
