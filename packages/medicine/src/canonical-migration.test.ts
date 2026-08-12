import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "202607300019_canonical_medicine_catalog.sql",
  ),
  "utf8",
).toLowerCase();

describe("canonical medicine catalogue migration", () => {
  it("extends the existing canonical model instead of creating a duplicate", () => {
    expect(sql).toContain("alter table public.medicines");
    expect(sql).not.toContain("create table public.medicines");
    expect(sql).not.toContain("create table public.active_ingredients");
    expect(sql).toContain("add column strength_normalized");
    expect(sql).toContain("add column catalog_version");
  });

  it("versions every master record and keeps evidence append-only", () => {
    expect(sql).toContain("create table public.medicine_catalog_versions");
    expect(sql).toContain("medicine_catalog_versions_append_only");
    expect(sql).toContain("medicines_catalog_version_guard");
    expect(sql).toContain("medicines_catalog_version_record");
    expect(sql).toContain("catalog_version := old.catalog_version + 1");
  });

  it("uses atomic, idempotent, administrator-only catalogue commands", () => {
    for (const command of [
      "save_catalog_medicine",
      "create_catalog_ingredient",
      "create_catalog_alternative",
      "merge_catalog_medicines",
    ]) {
      expect(sql).toContain(`function public.${command}`);
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${command}\\([\\s\\S]*?\\) to authenticated`,
        ),
      );
    }
    expect(sql).toContain("not public.is_platform_admin()");
    expect(sql).toContain("catalog save idempotency conflict");
    expect(sql).toContain("catalogue merge version conflict");
  });

  it("searches every approved canonical field with exact-match priority", () => {
    for (const field of [
      "brand",
      "generic",
      "ingredient",
      "manufacturer",
      "registration",
      "synonym",
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain("then 1.0");
    expect(sql).toContain("order by ranked.relevance desc");
  });

  it("never turns an alternative into an automatic substitution", () => {
    expect(sql).toContain("requires_pharmacist_review");
    expect(sql).toContain("requirespharmacistreview");
    expect(sql).toContain("catalogue alternatives must reference active medicines");
    expect(sql).not.toContain("requires_pharmacist_review = false");
  });

  it("prevents ordinary users from reading metadata for inactive medicines", () => {
    expect(sql).toContain(
      "drop policy medicine_registrations_read on public.medicine_registrations",
    );
    expect(sql).toContain(
      "drop policy medicine_equivalences_read on public.medicine_equivalences",
    );
    expect(sql).toMatch(
      /create policy medicine_registrations_read[\s\S]*?medicine\.status = 'active'/,
    );
    expect(sql).toMatch(
      /create policy medicine_equivalences_read[\s\S]*?source\.status = 'active'[\s\S]*?alternative\.status = 'active'/,
    );
  });

  it("contains no transaction boundary inside the migration", () => {
    expect(sql).not.toContain("commit;");
  });
});
