import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { provisionAuthE2EFixture } from "./lib/fixture";

const environmentSchema = z.object({
  MEDLINK_E2E_SUPABASE_URL: z.string().url(),
  MEDLINK_E2E_SUPABASE_SERVICE_KEY: z.string().min(1),
});

export default async function globalSetup(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
  const fixture = await provisionAuthE2EFixture(
    environment.MEDLINK_E2E_SUPABASE_URL,
    environment.MEDLINK_E2E_SUPABASE_SERVICE_KEY,
  );
  await writeFile(
    new URL("./.fixture.json", import.meta.url),
    JSON.stringify(fixture, null, 2),
  );
}
