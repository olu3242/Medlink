import { execFileSync, spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseEnv } from "node:util";

// Intentionally refuses hosted targets. Secrets stay in subprocess memory, never
// command arguments, logs, committed files, or the certification report.
const status = JSON.parse(execFileSync("supabase.exe", ["status", "--workdir", ".codex-run/structured-cert", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
if (!["127.0.0.1", "localhost"].includes(new URL(status.API_URL).hostname)
  || !["127.0.0.1", "localhost"].includes(new URL(status.DB_URL).hostname)) throw new Error("Certification runner requires isolated loopback services");
const configured = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
const env = { ...process.env, ...configured,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  MEDLINK_LIVE_SUPABASE_URL: status.API_URL, MEDLINK_LIVE_SUPABASE_ANON_KEY: status.ANON_KEY, MEDLINK_LIVE_SUPABASE_SERVICE_KEY: status.SERVICE_ROLE_KEY,
  MEDLINK_CERTIFICATION_DB_URL: status.DB_URL,
  MEDLINK_E2E_SUPABASE_URL: status.API_URL, MEDLINK_E2E_SUPABASE_SERVICE_KEY: status.SERVICE_ROLE_KEY,
  MEDLINK_E2E_SUPABASE_ANON_KEY: status.ANON_KEY,
  MEDLINK_E2E_MAILPIT_URL: status.INBUCKET_URL,
  NEXT_PUBLIC_APP_URL: "http://localhost:3100", MEDLINK_APP_URL: "http://localhost:3100", MEDLINK_PUBLIC_ORIGIN: "http://localhost:3100", MEDLINK_API_URL: "http://localhost:3100",
  MEDLINK_CERTIFICATION_LOCAL: "true", LOG_LEVEL: "silent",
};
const [mode, ...args] = process.argv.slice(2);
env.NODE_ENV = mode?.startsWith("build") ? "production" : mode === "dev" ? "development" : "test";
if (mode === "build-all") {
  for (const app of readdirSync("apps")) {
    const pkg = JSON.parse(readFileSync(`apps/${app}/package.json`, "utf8"));
    if (!pkg.scripts?.build) continue;
    if (pkg.scripts.build !== "next build") throw new Error(`Unsupported build command for ${app}`);
    const build = spawnSync(process.execPath, [resolve("node_modules/next/dist/bin/next"), "build", `apps/${app}`], { env, stdio: "inherit", windowsHide: true });
    console.log(`BUILD_${app.toUpperCase()}_EXIT=${build.status}`);
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  process.exit(0);
}
if (mode === "migrate") {
  const { Client } = await import("pg");
  const { readFile } = await import("node:fs/promises");
  const db = new Client({ connectionString: status.DB_URL });
  await db.connect();
  try {
    const version = "202609160086";
    const sql = await readFile(`supabase/migrations/${version}_catalogue_discovery_contacts.sql`, "utf8");
    await db.query("begin");
    const applied = await db.query("select version from supabase_migrations.schema_migrations where version=$1", [version]);
    if (applied.rowCount) throw new Error("Migration is already recorded; run the reapplication test instead");
    await db.query(sql);
    await db.query("insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)", [version, "catalogue_discovery_contacts", [sql]]);
    await db.query("commit");
    console.log("LOCAL_MIGRATION_202609160086=APPLIED; historical ledger unchanged");
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
  process.exit(0);
}
const commands = {
  test: ["node_modules/vitest/vitest.mjs", "run", ...args],
  dev: ["node_modules/next/dist/bin/next", "dev", "apps/web", "--port", "3100"],
  build: ["node_modules/next/dist/bin/next", "build", "apps/web"],
  e2e: ["node_modules/@playwright/test/cli.js", "test", "--config", "packages/e2e/structured-search.config.ts", ...args],
};
if (!commands[mode]) throw new Error("Expected test, dev, build, or e2e");
const [file, ...rest] = commands[mode];
const child = spawn(process.execPath, [resolve(file), ...rest], { env, stdio: "inherit", windowsHide: true });
child.on("exit", (code) => process.exit(code ?? 1));
