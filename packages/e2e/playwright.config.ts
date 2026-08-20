import { defineConfig } from "@playwright/test";
import { applyTargetToEnvironment, resolveTarget } from "./config/targets";

const target = resolveTarget();
applyTargetToEnvironment(target);

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    [process.env.CI ? "line" : "list"],
    ["./reports/certification-reporter.ts"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "artifacts/e2e/results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
