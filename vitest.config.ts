import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Scoped to packages/**: domain, application, and runtime logic that
      // vitest unit-tests directly. apps/** are Next.js UI and route
      // handlers exercised through integration/e2e coverage instead (see
      // docs/audit/RC1_BACKLOG.md P1 item 11), so including them here would
      // just dilute the gate with untested React/route boilerplate.
      include: ["packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 65,
        lines: 70,
      },
    },
  },
});
