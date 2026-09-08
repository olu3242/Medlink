import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const jobs = ["migration-apply", "live-database", "browser-auth-e2e", "medication-golden-loop-e2e"];
const blocks = jobs.map((job) => {
  const start = workflow.indexOf(`  ${job}:`);
  const nextJob = workflow.slice(start + 3).search(/\n  [a-z0-9-]+:\n/u);
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
if ((workflow.match(/CI_SUPABASE_INBUCKET_PORT/g) ?? []).length < 3) {
  throw new Error("E2E jobs must consume the isolated Inbucket port");
}
console.log(`CI Supabase isolation contract passed for ${jobs.length} jobs.`);