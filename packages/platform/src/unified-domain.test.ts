import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = { readonly dependencies?: Readonly<Record<string, string>> };
const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const personas = ["admin", "patient", "pharmacist", "pharmacy"] as const;
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

describe("single-app MedLink frontend contract", () => {
  it("mounts every production-ready persona inside apps/web", () => {
    for (const persona of personas) {
      expect(existsSync(join(repositoryRoot, `apps/web/app/${persona}/page.tsx`))).toBe(true);
      expect(existsSync(join(repositoryRoot, `apps/web/app/${persona}/layout.tsx`))).toBe(true);
    }
    expect(existsSync(join(repositoryRoot, "apps/web/app/provider/page.tsx"))).toBe(false);
  });

  it("keeps shared APIs canonical and persona APIs explicitly owned", () => {
    expect(read("apps/web/app/api/v1/medicines/route.ts")).toContain("SupabaseCanonicalMedicineRepository");
    for (const persona of personas) {
      expect(existsSync(join(repositoryRoot, `apps/web/app/${persona}/api/v1`))).toBe(true);
    }
  });

  it("uses one auth callback and guarded persona layouts", () => {
    expect(existsSync(join(repositoryRoot, "apps/web/app/auth/callback/route.ts"))).toBe(true);
    for (const persona of personas) {
      expect(read(`apps/web/app/${persona}/layout.tsx`)).toContain(`requirePersonaAccess("${persona}")`);
    }
    expect(read("apps/web/lib/role-landing.ts")).not.toMatch(/@|email/i);
  });

  it("has no external child routing or microfrontends runtime", () => {
    const config = read("apps/web/next.config.ts");
    expect(config).not.toContain("MEDLINK_ADMIN_ORIGIN");
    expect(config).not.toContain("destination:");
    expect(config).not.toContain("withMicrofrontends");
    for (const app of ["web", ...personas]) {
      const manifest = JSON.parse(read(`apps/${app}/package.json`)) as PackageManifest;
      expect(manifest.dependencies?.["@vercel/microfrontends"]).toBeUndefined();
    }
  });

  it("preserves legacy Control Center compatibility without duplicating it", () => {
    expect(read("apps/web/app/control-center/[[...path]]/page.tsx")).toContain("/admin");
    expect(read("apps/web/app/admin/page.tsx")).toContain("admin/app/control-center/page");
  });

  it("uses same-host navigation and browser API paths", () => {
    for (const path of [
      "apps/admin/components/medicine-form.tsx",
      "apps/patient/components/inventory-search.tsx",
      "apps/pharmacist/components/decision-form.tsx",
      "apps/pharmacy/components/inventory-dashboard.tsx",
    ]) expect(read(path), path).not.toMatch(/https?:\/\/[^`"']*vercel\.app/);
  });

  it("retains safe structured Admin diagnostics", () => {
    const api = read("apps/admin/lib/api.ts");
    for (const field of ["portal", "route", "upstream", "status", "request_id", "correlation_id", "error_class"]) {
      expect(api).toContain(field);
    }
    expect(api).not.toMatch(/console\.error\([^)]*(cookie|authorization|token)/i);
  });
});
