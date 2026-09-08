import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const wrapper = await readFile(new URL("./ci-supabase.sh", import.meta.url), "utf8");
const repositorySupabase = new URL("../supabase/", import.meta.url);
const configWriter = new URL("./write-ci-supabase-config.mjs", import.meta.url);
const jobs = ["migration-apply", "live-database", "browser-auth-e2e", "medication-golden-loop-e2e"];
const blocks = jobs.map((job) => {
  const start = workflow.indexOf(`  ${job}:`);
  const nextJob = workflow.slice(start + 3).search(/\n {2}[a-z0-9-]+:\n/u);
  const end = nextJob < 0 ? -1 : start + 3 + nextJob;
  if (start < 0) throw new Error(`missing Supabase job: ${job}`);
  return [job, workflow.slice(start, end < 0 ? workflow.length : end)];
});

for (const [job, block] of blocks) {
  for (const required of [
    "source tools/ci-supabase.sh && ci_supabase_start",
    "source tools/ci-supabase.sh && ci_supabase_reset",
    "source tools/ci-supabase.sh && ci_supabase_cleanup",
  ]) {
    if (!block.includes(required)) throw new Error(`${job} is missing ${required}`);
  }
}
if (workflow.includes("npx supabase start") || workflow.includes("npx supabase stop")) {
  throw new Error("CI workflow contains direct Supabase lifecycle commands");
}
const isolatedE2EBlocks = blocks
  .filter(([job]) => job === "browser-auth-e2e" || job === "medication-golden-loop-e2e")
  .map(([, block]) => block)
  .join("\n");
assert.doesNotMatch(isolatedE2EBlocks, /(?:localhost|127\.0\.0\.1):5432[1-7]/u,
  "isolated E2E jobs must not depend on repository-default Supabase endpoints");
const mailpitAssignments = isolatedE2EBlocks.match(/MEDLINK_E2E_MAILPIT_URL=[^\n]+/gu) ?? [];
assert.ok(mailpitAssignments.length >= 4, "all isolated browser scenarios must define their Mailpit endpoint");
for (const assignment of mailpitAssignments) {
  assert.match(assignment, /\$\{CI_SUPABASE_INBUCKET_PORT\}/u,
    `isolated Mailpit endpoint must use CI_SUPABASE_INBUCKET_PORT: ${assignment}`);
}

for (const required of [
  'mkdir -p "$CI_SUPABASE_WORKDIR/supabase"',
  'cp -R supabase/. "$CI_SUPABASE_WORKDIR/supabase/"',
  'CI_SUPABASE_CONFIG_PATH="$CI_SUPABASE_WORKDIR/supabase/config.toml"',
  'test -d "$CI_SUPABASE_WORKDIR/supabase/migrations"',
  "ci_supabase_assert_port_parity",
  "ci_supabase_assert_schema",
  "toomanyrequests",
  "429",
  "rate exceeded",
  "ci_supabase_retry_cleanup",
  "CI_SUPABASE_TRANSIENT_CHAIN",
  'CI_SUPABASE_EXCLUDE_SERVICES="studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api"',
  'start_args+=(--exclude "$CI_SUPABASE_EXCLUDE_SERVICES")',
  'safe_run_id="$(printf \'%s\' "$run_id" | tr -cd \'a-zA-Z0-9-\' | cut -c1-12)"',
  'CI_SUPABASE_PROJECT_ID="medlink-ci-${slot}-${safe_run_id}-${attempt}-${safe_job:0:10}"',
  '[[ "${#CI_SUPABASE_PROJECT_ID}" -le 40 ]]',
]) assert.ok(wrapper.includes(required), `CI wrapper is missing contract: ${required}`);
assert.ok(!wrapper.includes('$CI_SUPABASE_WORKDIR/config.toml'), "config must not be written at the workdir root");
for (const forbidden of ["docker system prune", "docker volume prune", "supabase stop --all"]) {
  assert.ok(!wrapper.includes(forbidden), `CI wrapper contains unsafe global cleanup: ${forbidden}`);
}
assert.match(wrapper, /for attempt in 1 2 3;/u, "Supabase startup must remain bounded to three attempts");
assert.match(wrapper, /migration-apply\)[\s\S]*?CI_SUPABASE_EXCLUDE_SERVICES="studio,imgproxy,edge-runtime,logflare,vector,realtime,storage-api"/u,
  "migration apply must avoid unrelated Supabase services during cold startup");
assert.match(wrapper, /name=\$\{CI_SUPABASE_PROJECT_ID\}/u,
  "retry cleanup must filter Docker resources by the isolated project ID");
assert.doesNotMatch(wrapper, /CI_SUPABASE_EXCLUDE_SERVICES="[^"]*(?:gotrue|postgrest|kong|mailpit|postgres-meta)[^"]*"/u,
  "browser auth must retain Auth, REST, gateway, Mailpit, and metadata services");
assert.match(wrapper, /if ! ci_supabase_assert_port_parity \|\| ! ci_supabase_assert_schema; then\s+return 1/u,
  "port or schema assertion failures must fail immediately without entering the start retry path");

const slots = new Map([
  ["migration-apply", 0],
  ["live-database", 1],
  ["browser-auth-e2e", 2],
  ["medication-golden-loop-e2e", 3],
]);
const portKeys = ["API", "DB", "STUDIO", "INBUCKET", "SMTP", "POP3", "ANALYTICS"];
const offsets = [54321, 54322, 54323, 54324, 54325, 54326, 54327];
const repositoryDefaultPorts = new Set(offsets);
const allPorts = new Set();
const root = await mkdtemp(join(tmpdir(), "medlink-ci-isolation-"));
try {
  for (const [job, slot] of slots) {
    const projectRoot = join(root, job);
    const supabaseDir = join(projectRoot, "supabase");
    await cp(repositorySupabase, supabaseDir, { recursive: true });
    const configPath = join(supabaseDir, "config.toml");
    const migrations = await readdir(join(supabaseDir, "migrations"));
    assert.ok(migrations.length > 0, `${job} did not copy migration assets`);
    assert.ok(migrations.includes("202607270001_platform_core.sql"), `${job} is missing the platform schema migration`);
    assert.ok(migrations.includes("202607270006_transactional_runtime.sql"), `${job} is missing the runtime schema migration`);

    const ports = offsets.map((base) => base + slot * 10);
    if (slot > 0) {
      for (const port of ports) assert.ok(!repositoryDefaultPorts.has(port), `${job} silently reused a repository-default port`);
    }
    const env = { ...process.env, CI_SUPABASE_PROJECT_ID: `medlink-ci-${job}-contract`, CI_SUPABASE_CONFIG_PATH: configPath };
    portKeys.forEach((key, index) => { env[`CI_SUPABASE_${key}_PORT`] = String(ports[index]); });
    const generated = spawnSync(process.execPath, [fileURLToPath(configWriter), configPath], { env, encoding: "utf8" });
    assert.equal(
      generated.status,
      0,
      generated.error?.message || generated.stderr || `${job} config generation failed`,
    );

    const config = await readFile(configPath, "utf8");
    assert.match(config, new RegExp(`^project_id\\s*=\\s*"medlink-ci-${job}-contract"$`, "m"));
    for (const [section, expected] of [["api", ports[0]], ["db", ports[1]], ["studio", ports[2]], ["inbucket", ports[3]], ["analytics", ports[6]]]) {
      const match = config.match(new RegExp(`\\[${section}\\][\\s\\S]*?\\nport\\s*=\\s*(\\d+)`));
      assert.equal(Number(match?.[1]), expected, `${job} ${section}.port does not match its assigned range`);
    }
    assert.match(config, new RegExp(`smtp_port\\s*=\\s*${ports[4]}`));
    assert.match(config, new RegExp(`pop3_port\\s*=\\s*${ports[5]}`));
    for (const port of ports) {
      assert.ok(!allPorts.has(port), `port ${port} is shared across isolated jobs`);
      allPorts.add(port);
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log(`CI Supabase isolation contract passed for ${jobs.length} jobs.`);
