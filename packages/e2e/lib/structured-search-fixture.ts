import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

export const fixtureId = (number: number) => `b8610000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const fixtureProducts = [
  { key: "reference", name: "CERT Combination", amounts: [500, 125], strength: "500 mg + 125 mg" },
  { key: "exact", name: "CERT Equivalent", amounts: [500, 125], strength: "500 mg + 125 mg" },
  { key: "ratio", name: "CERT Changed Ratio", amounts: [125, 500], strength: "500 mg + 125 mg" },
  { key: "strength", name: "CERT Other Strength", amounts: [1000, 125], strength: "1000 mg + 125 mg" },
  { key: "form", name: "CERT Other Form", amounts: [500, 125], strength: "500 mg + 125 mg", form: "capsule" },
  { key: "route", name: "CERT Other Route", amounts: [500, 125], strength: "500 mg + 125 mg", route: "topical" },
  { key: "registration", name: "CERT Unverified Registration", amounts: [500, 125], strength: "500 mg + 125 mg", registration: false },
  { key: "inactive", name: "CERT Retired", amounts: [500, 125], strength: "500 mg + 125 mg", status: "retired" },
  { key: "incomplete", name: "CERT Incomplete", amounts: [null, 125], strength: "500 mg + 125 mg" },
  { key: "unavailable", name: "CERT No Stock", amounts: [500, 125], strength: "500 mg + 125 mg" },
  { key: "single", name: "CERT Single Ingredient", amounts: [500], strength: "500 mg" },
  { key: "units", name: "CERT Converted Units", amounts: [0.5, 0.125], strength: "0.125 g + 0.5 g", unit: "g" },
  { key: "empty", name: "CERT Legacy Incomplete", amounts: [], strength: "unknown" },
] as const;

export async function prepareStructuredSearchFixture() {
  const url = process.env.MEDLINK_E2E_SUPABASE_URL!;
  const connectionString = process.env.MEDLINK_CERTIFICATION_DB_URL!;
  if (process.env.MEDLINK_CERTIFICATION_LOCAL !== "true" || new URL(url).hostname !== "127.0.0.1"
    || !["127.0.0.1", "localhost"].includes(new URL(connectionString).hostname)) throw new Error("Synthetic fixture is local-only");
  const db = new Client({ connectionString });
  const service = createClient(url, process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
  await db.connect();
  const users: Record<string, { id: string; email: string }> = {};
  try {
    for (const role of ["patient", "pharmacist", "pharmacy_staff", "platform_admin"]) {
      const email = `structured-search-${role}@cert.medlink.test`;
      const existing = (await db.query("select id from auth.users where email=$1", [email])).rows[0];
      if (existing) users[role] = { id: existing.id, email };
      else {
        const { data, error } = await service.auth.admin.createUser({ email, email_confirm: true });
        if (error || !data.user) throw new Error("Could not create synthetic certification persona");
        users[role] = { id: data.user.id, email };
      }
    }
    await db.query("begin");
    for (const [index, name] of [[1, "Patient"], [2, "Pharmacy"]] as const) {
      await db.query("insert into public.organizations(id,name,slug,type) values($1,$2,$3,'pharmacy') on conflict(id) do nothing", [fixtureId(index), `CERT Search ${name}`, `cert-search-${name.toLowerCase()}`]);
    }
    for (const [role, user] of Object.entries(users)) {
      await db.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3) on conflict do nothing", [fixtureId(role === "pharmacy_staff" ? 2 : 1), user.id, role]);
    }
    for (const [index, name] of [[10, "CERT Ingredient Alpha"], [11, "CERT Ingredient Beta"]] as const) {
      await db.query("insert into public.active_ingredients(id,preferred_name) values($1,$2) on conflict(id) do nothing", [fixtureId(index), name]);
    }
    const products: Record<string, string> = {};
    for (const [index, product] of fixtureProducts.entries()) {
      const id = fixtureId(100 + index); products[product.key] = id;
      await db.query(`insert into public.medicines(id,brand_name,generic_name,dosage_form,route,strength_display,manufacturer_name,status)
        values($1,$2,'CERT Ingredient Alpha + CERT Ingredient Beta',$3,$4,$5,'CERT Manufacturer',$6) on conflict(id) do nothing`,
      [id, product.name, "form" in product ? product.form : "tablet", "route" in product ? product.route : "oral", product.strength, "status" in product ? product.status : "active"]);
      for (const [component, amount] of product.amounts.entries()) {
        await db.query("insert into public.medicine_ingredients(medicine_id,active_ingredient_id,amount,unit,is_primary) values($1,$2,$3,$4,$5) on conflict do nothing", [id, fixtureId(10 + component), amount, "unit" in product ? product.unit : "mg", component === 0]);
      }
      if (!("registration" in product)) await db.query(`insert into public.medicine_registrations(medicine_id,country_code,authority_code,registration_number,valid_from,valid_until)
        values($1,'NG','NAFDAC',$2,'2020-01-01','2099-12-31') on conflict do nothing`, [id, `CERT-ONLY-${index}`]);
    }
    await db.query(`insert into public.medicine_equivalences(source_medicine_id,equivalent_medicine_id,kind,rationale,requires_pharmacist_review,status,created_by,approved_by,approved_at,effective_from)
      values($1,$2,'therapeutic','Synthetic certification relationship only',true,'active',$3,$3,now(),'2020-01-01') on conflict do nothing`, [products.reference, products.single, users.platform_admin!.id]);
    await db.query(`insert into public.inventory_freshness_policies(id,reference,source_type,max_age_seconds,approved_by,approval_evidence,effective_at)
      values($1,'certification://structured-search','manual',86400,$2,'Synthetic local certification only',now()) on conflict do nothing`, [fixtureId(400), users.platform_admin!.id]);
    for (let index = 0; index < 3; index++) {
      await db.query(`insert into public.pharmacy_locations(id,organization_id,name,license_number,address_line_1,locality,country_code,latitude,longitude,phone)
        values($1,$2,$3,$4,'Synthetic test address','Lagos','NG',6.5244,$5,'+2348000000000') on conflict(id) do nothing`,
      [fixtureId(200 + index), fixtureId(2), `CERT Pharmacy ${index + 1}`, `CERT-LICENSE-${index}`, 3.3792 + index * 0.01]);
      await db.query(`insert into public.inventory_sources(id,organization_id,pharmacy_location_id,source_type,name,policy_id,created_by)
        values($1,$2,$3,'manual','CERT source',$4,$5) on conflict do nothing`, [fixtureId(410 + index), fixtureId(2), fixtureId(200 + index), fixtureId(400), users.pharmacy_staff!.id]);
      await db.query(`insert into public.inventory_batches(id,organization_id,pharmacy_location_id,medicine_id,batch_number,expires_on,quantity_on_hand,unit,status,created_by,unit_price_minor,unit_price_currency_code,source_updated_at,inventory_source_id)
        values($1,$2,$3,$4,$5,'2099-12-31',$6,'tablet','available',$7,$8,'NGN',now()-($9::integer * interval '1 hour'),$10)
        on conflict(id) do update set source_updated_at=excluded.source_updated_at`,
      [fixtureId(300 + index), fixtureId(2), fixtureId(200 + index), products.reference, `CERT-BATCH-${index}`, index === 1 ? 2 : 20, users.pharmacy_staff!.id, 10000 - index * 2000, index === 2 ? 72 : index, fixtureId(410 + index)]);
    }
    await db.query("commit");
    return { users, products, patientOrganizationId: fixtureId(1), pharmacyOrganizationId: fixtureId(2) };
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}
