import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blocksRelease, evaluateExperienceConformance, type ConformanceSource } from "./experience-conformance";

const root = process.cwd();
const operationalPortals = ["admin", "dashboard", "developer", "patient", "pharmacist", "pharmacy", "provider"];
const read = (file: string): ConformanceSource => ({ file, content: readFileSync(join(root, file), "utf8") });

describe("enterprise experience architecture conformance", () => {
  const layouts = operationalPortals.map((portal) => read(`apps/${portal}/app/layout.tsx`));
  const patientComponents = ["apps/patient/app/page.tsx", "apps/patient/app/search/page.tsx", "apps/patient/app/notifications/page.tsx"].map(read);
  const patientRoutes = [
    "inventory/route.ts", "mar/route.ts", "mar/[id]/route.ts", "mar/[id]/timeline/route.ts",
    "notifications/route.ts", "pharmacies/route.ts", "reservations/route.ts", "review/route.ts", "review/[id]/route.ts",
  ].map((route) => read(`apps/patient/app/api/v1/${route}`));

  it("blocks AppShell, client database, and runtime boundary violations", () => {
    const findings = evaluateExperienceConformance({ portalLayouts: layouts, reactSources: patientComponents, apiRoutes: patientRoutes });
    expect(findings).toEqual([]);
    expect(blocksRelease(findings)).toBe(false);
  });

  it("distinguishes registry migration debt from release-blocking bypasses", () => {
    const warnings = evaluateExperienceConformance({ portalLayouts: [], reactSources: [], apiRoutes: [{ file: "legacy.ts", content: "runApi(request, operation)" }] });
    expect(warnings).toMatchObject([{ severity: "warning", rule: "experience-registry-adoption" }]);
    expect(blocksRelease(warnings)).toBe(false);
    const violations = evaluateExperienceConformance({ portalLayouts: [], reactSources: [{ file: "page.tsx", content: "database.from('patients')" }], apiRoutes: [] });
    expect(blocksRelease(violations)).toBe(true);
  });
});
