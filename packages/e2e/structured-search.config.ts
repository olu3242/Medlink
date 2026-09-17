import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "structured-search.spec.ts", fullyParallel: false, workers: 1, retries: 0,
  timeout: 90000, reporter: [["json", { outputFile: "../../.codex-run/structured-cert/browser-results.json" }]],
  outputDir: "../../.codex-run/structured-cert/browser-artifacts",
  use: { baseURL: "http://localhost:3100", trace: "off", screenshot: "only-on-failure", permissions: ["geolocation"], geolocation: { latitude: 6.5244, longitude: 3.3792 } },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } }, { name: "mobile", use: { viewport: { width: 390, height: 844 } } }],
});
