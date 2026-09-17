import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { prepareStructuredSearchFixture } from "../../e2e/lib/structured-search-fixture";

const connectionString = process.env.MEDLINK_CERTIFICATION_DB_URL;
const local = connectionString && process.env.MEDLINK_CERTIFICATION_LOCAL === "true"
  && ["127.0.0.1", "localhost"].includes(new URL(connectionString).hostname);
describe.skipIf(!local)("structured search migration on isolated previous schema", () => {
  it("applies and reapplies without changing data, constraints, indexes or RLS; denies anonymous execution", async () => {
    await prepareStructuredSearchFixture();
    const db = new Client({ connectionString });
    await db.connect();
    try {
      await db.query("begin");
      const migration = await readFile("supabase/migrations/202609160086_catalogue_discovery_contacts.sql", "utf8");
      const snapshot = async () => (await db.query(`select
        (select count(*) from public.medicines) medicines,
        (select count(*) from public.inventory_batches) batches,
        (select count(*) from pg_constraint where connamespace = 'public'::regnamespace) constraints,
        (select count(*) from pg_indexes where schemaname = 'public') indexes,
        (select count(*) from pg_policies where schemaname = 'public') policies`)).rows[0];
      const before = await snapshot();
      await db.query(migration);
      const definition = (await db.query("select pg_get_functiondef('public.discover_catalogue_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid)'::regprocedure) definition")).rows[0].definition;
      await db.query(migration);
      expect(await snapshot()).toEqual(before);
      expect(definition).toContain("discover_marketplace_inventory");
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path TO ''");
      const permissions = (await db.query(`select
        has_function_privilege('anon','public.discover_catalogue_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid)','execute') anon,
        has_function_privilege('authenticated','public.discover_catalogue_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid)','execute') authenticated`)).rows[0];
      expect(permissions).toEqual({ anon: false, authenticated: true });
      await db.query("savepoint denial");
      await db.query("set local role anon");
      await expect(db.query("select * from public.discover_catalogue_inventory(null,null,0,0,25,1,null)")).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback to savepoint denial");
      await db.query("set local role authenticated");
      await expect(db.query("select * from public.discover_catalogue_inventory(null,null,0,0,25,1,null)")).rejects.toMatchObject({ code: "42501" });
    } finally { await db.query("rollback"); await db.end(); }
  });
});
