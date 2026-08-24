import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { createRunId, type CertificationRunContext } from "./lib/run-context";
import { provisionAuthE2EFixture } from "./lib/fixture";
import { provisionGoldenLoopFixture } from "./lib/golden-fixture";
import { provisionPersonaCertificationFixture } from "./personas/factory";

const environmentSchema = z.object({
  MEDLINK_E2E_SUPABASE_URL: z.string().url(),
  MEDLINK_E2E_SUPABASE_SERVICE_KEY: z.string().min(1),
});

export default async function globalSetup(): Promise<void> {
  const runContext: CertificationRunContext = {
    runId: process.env.MEDLINK_E2E_RUN_ID ?? createRunId(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    environment: process.env.MEDLINK_E2E_TARGET ?? process.env.E2E_TARGET ?? "local",
    startedAt: new Date().toISOString(),
  };
  await mkdir(new URL("../../../artifacts/e2e/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("./.certification-run.json", import.meta.url),
    JSON.stringify(runContext, null, 2),
  );
  if (process.env.MEDLINK_E2E_PROVISION_FIXTURES === "false") return;
  const environment = environmentSchema.parse(process.env);
  const [authFixture, goldenLoopFixture, personaFixture] = await Promise.all([
    provisionAuthE2EFixture(
      environment.MEDLINK_E2E_SUPABASE_URL,
      environment.MEDLINK_E2E_SUPABASE_SERVICE_KEY,
    ),
    provisionGoldenLoopFixture(
      environment.MEDLINK_E2E_SUPABASE_URL,
      environment.MEDLINK_E2E_SUPABASE_SERVICE_KEY,
    ),
    provisionPersonaCertificationFixture(
      environment.MEDLINK_E2E_SUPABASE_URL,
      environment.MEDLINK_E2E_SUPABASE_SERVICE_KEY,
      runContext.runId,
    ),
  ]);
  await writeFile(
    new URL("./.fixture.json", import.meta.url),
    JSON.stringify(authFixture, null, 2),
  );
  await writeFile(
    new URL("./.golden-loop-fixture.json", import.meta.url),
    JSON.stringify(goldenLoopFixture, null, 2),
  );
  await writeFile(
    new URL("./.persona-fixture.json", import.meta.url),
    JSON.stringify(personaFixture, null, 2),
  );
}
