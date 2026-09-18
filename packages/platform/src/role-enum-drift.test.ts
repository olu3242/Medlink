import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roles } from "./roles";

// Authorization convergence repair, item 8: TypeScript's Role and Postgres's
// member_role enum must stay in lockstep -- a role permitted by one but not
// recognized by the other is a silent authorization gap either way. Rather
// than hardcoding a second, independent role list to compare `roles` against
// (which would just be one more place to forget to update), this parses the
// actual migration SQL that defines member_role: its initial
// `create type ... as enum (...)` values plus every later
// `alter type ... add value ...`. The set derived here is exactly what a
// freshly-migrated Postgres database would have as its member_role values.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations");

function postgresMemberRoleValues(): string[] {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const values = new Set<string>();
  let foundDefinition = false;

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");

    const created = sql.match(/create type public\.member_role as enum\s*\(([^)]*)\)/i);
    if (created?.[1] !== undefined) {
      foundDefinition = true;
      for (const match of created[1].matchAll(/'([a-z0-9_]+)'/g)) {
        if (match[1] !== undefined) values.add(match[1]);
      }
    }

    for (const match of sql.matchAll(
      /alter type public\.member_role add value(?: if not exists)?\s+'([a-z0-9_]+)'/gi,
    )) {
      if (match[1] !== undefined) values.add(match[1]);
    }
  }

  if (!foundDefinition) {
    throw new Error(`Could not find "create type public.member_role as enum (...)" under ${migrationsDir}`);
  }
  return [...values].sort();
}

describe("TypeScript Role vs. Postgres member_role enum", () => {
  it("has no drift between packages/platform/src/roles.ts and the member_role migrations", () => {
    const postgresRoles = postgresMemberRoleValues();
    const typescriptRoles: string[] = [...roles].sort();

    const onlyInPostgres = postgresRoles.filter((role) => !typescriptRoles.includes(role));
    const onlyInTypeScript = typescriptRoles.filter((role) => !postgresRoles.includes(role));

    expect(
      { onlyInPostgres, onlyInTypeScript },
      "member_role (Postgres) and Role (TypeScript) have drifted -- every role must exist in both",
    ).toEqual({ onlyInPostgres: [], onlyInTypeScript: [] });
  });
});
