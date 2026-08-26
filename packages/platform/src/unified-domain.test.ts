import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = { readonly dependencies?: Readonly<Record<string, string>> };
const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const portals = ["admin", "patient", "pharmacist", "pharmacy"] as const;
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

describe("unified MedLink gateway contract", () => {
  const gateway = read("apps/web/next.config.ts");

  it("keeps web as gateway and canonical API owner", () => {
    for (const portal of portals) expect(gateway).toContain(`source: "/${portal}/:path*"`);
    expect(gateway).not.toContain('source: "/api/:path*"');
    expect(read("apps/web/app/api/v1/medicines/route.ts")).toContain("SupabaseCanonicalMedicineRepository");
    expect(read("apps/web/app/api/v1/medicines/[id]/route.ts")).toContain("SupabaseCanonicalMedicineRepository");
  });

  it("uses environment-owned upstreams and fails closed on Vercel", () => {
    for (const name of ["ADMIN", "PATIENT", "PHARMACIST", "PHARMACY"]) {
      expect(gateway).toContain(`MEDLINK_${name}_ORIGIN`);
    }
    expect(gateway).toContain('process.env.VERCEL === "1"');
    expect(gateway).not.toMatch(/https:\/\/[^`"']*vercel\.app/);
  });

  it("isolates child assets and preserves prefixed standalone routes", () => {
    for (const portal of portals) {
      const config = read(`apps/${portal}/next.config.ts`);
      expect(config).toContain(`assetPrefix: "/${portal}"`);
      expect(config).toContain(`source: "/${portal}/:path*"`);
      expect(config).not.toContain("withMicrofrontends");
    }
  });

  it("does not depend on Vercel Microfrontends", () => {
    for (const app of ["web", ...portals]) {
      const manifest = JSON.parse(read(`apps/${app}/package.json`)) as PackageManifest;
      expect(manifest.dependencies?.["@vercel/microfrontends"]).toBeUndefined();
    }
  });

  it("uses portal-owned callbacks and browser API paths", () => {
    for (const portal of ["patient", "pharmacist", "pharmacy"]) {
      expect(read(`apps/${portal}/app/auth/sign-in/actions.ts`)).toContain(`/${portal}/auth/callback`);
    }
    expect(read("packages/platform/src/server-origin.ts")).toContain('process.env.VERCEL === "1"');
    for (const path of [
      "apps/admin/components/medicine-form.tsx",
      "apps/patient/components/inventory-search.tsx",
      "apps/pharmacist/components/decision-form.tsx",
      "apps/pharmacy/components/inventory-dashboard.tsx",
    ]) expect(read(path), path).not.toMatch(/fetch\((?:"|'|`)\/api\//);
  });

  it("logs safe structured upstream diagnostics", () => {
    const api = read("apps/admin/lib/api.ts");
    expect(api).toContain("MEDLINK_ADMIN_URL");
    for (const field of ["portal", "route", "upstream", "status", "request_id", "correlation_id", "error_class"]) {
      expect(api).toContain(field);
    }
    expect(api).not.toMatch(/console\.error\([^)]*(cookie|authorization|token)/i);
  });
});
