import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface TenantTable {
  readonly table: string;
  readonly migration: string;
}

function migrationCorpus(): { sql: string; tables: readonly TenantTable[] } {
  const directory = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
  const documents = files.map((migration) => ({
    migration,
    sql: readFileSync(join(directory, migration), "utf8").toLowerCase(),
  }));
  const tables = documents.flatMap(({ migration, sql }) =>
    [...sql.matchAll(/create table(?: if not exists)? public\.([a-z0-9_]+)\s*\(([\s\S]*?)\);/g)]
      .filter((match) => /\borganization_id\b/.test(match[2] ?? ""))
      .map((match) => ({ table: match[1] ?? "", migration })),
  );
  return { sql: documents.map((document) => document.sql).join("\n"), tables };
}

describe("tenant RLS matrix", () => {
  const corpus = migrationCorpus();
  const workerOnly = new Set([
    "notification_outbox",
    "notification_delivery_attempts",
    "integration_webhook_messages",
    "integration_delivery_attempts",
    "api_client_credentials",
  ]);

  it("discovers tenant-scoped tables from every migration", () => {
    expect(corpus.tables.length).toBeGreaterThan(20);
    expect(new Set(corpus.tables.map(({ table }) => table)).size).toBe(corpus.tables.length);
  });

  it.each(corpus.tables)("$table has an explicit allowance or deny-by-default posture", ({ table }) => {
    expect(corpus.sql).toMatch(
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
    const policy = new RegExp(`create policy [a-z0-9_]+\\s+on public\\.${table}`);
    if (workerOnly.has(table)) {
      expect(corpus.sql).not.toMatch(policy);
    } else {
      expect(corpus.sql).toMatch(policy);
    }
  });
});
