import { defineConfig } from "@playwright/test";

// Auth-only browser certification (Section 15's "who is acting" gate).
// Deliberately kept separate from the full medication golden-loop E2E
// suite -- that suite (patient -> pharmacist -> patient -> pharmacy ->
// patient -> pharmacy) is the next, separately-gated certification.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    trace: "retain-on-failure",
  },
});
