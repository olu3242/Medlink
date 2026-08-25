import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type MicrofrontendApplication = {
  readonly packageName?: string;
  readonly routing?: readonly { readonly paths: readonly string[] }[];
};

type MicrofrontendsConfig = {
  readonly applications: Readonly<Record<string, MicrofrontendApplication>>;
};

type PackageManifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
};

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const appNames = ["web", "admin", "patient", "pharmacist", "pharmacy"] as const;
const projectNames = [
  "medlink",
  "medlink-admin",
  "medlink-patient",
  "medlink-pharmacist",
  "medlink-pharmacy",
] as const;

function read(path: string): string {
  return readFileSync(join(repositoryRoot, path), "utf8");
}

describe("unified MedLink domain contract", () => {
  const config = JSON.parse(
    read("apps/web/microfrontends.json"),
  ) as MicrofrontendsConfig;

  it("keeps the public web project as the only default application", () => {
    expect(Object.keys(config.applications).sort()).toEqual([...projectNames].sort());
    expect(config.applications.medlink?.routing).toBeUndefined();
    expect(
      Object.entries(config.applications)
        .filter(([, application]) => application.routing === undefined)
        .map(([name]) => name),
    ).toEqual(["medlink"]);
  });

  it("assigns every portal and legacy Control Center path unambiguously", () => {
    expect(config.applications["medlink-admin"]?.routing?.[0]?.paths).toEqual([
      "/admin",
      "/admin/:path*",
      "/control-center",
      "/control-center/:path*",
    ]);
    expect(config.applications["medlink-patient"]?.routing?.[0]?.paths).toEqual([
      "/patient",
      "/patient/:path*",
    ]);
    expect(config.applications["medlink-pharmacist"]?.routing?.[0]?.paths).toEqual([
      "/pharmacist",
      "/pharmacist/:path*",
    ]);
    expect(config.applications["medlink-pharmacy"]?.routing?.[0]?.paths).toEqual([
      "/pharmacy",
      "/pharmacy/:path*",
    ]);
  });

  it("declares and enables the Vercel integration in every participating app", () => {
    for (const appName of appNames) {
      const manifest = JSON.parse(read(`apps/${appName}/package.json`)) as PackageManifest;
      const nextConfig = read(`apps/${appName}/next.config.ts`);
      expect(manifest.dependencies?.["@vercel/microfrontends"]).toBe("2.4.0");
      expect(nextConfig).toContain("withMicrofrontends(nextConfig)");
      expect(nextConfig).not.toContain("basePath");
    }
  });

  it("uses portal-owned callbacks and browser API paths", () => {
    expect(read("apps/patient/app/auth/sign-in/actions.ts")).toContain(
      "/patient/auth/callback",
    );
    expect(read("apps/patient/app/auth/sign-in/actions.ts")).toContain(
      "process.env.MEDLINK_PUBLIC_ORIGIN",
    );
    expect(read("apps/pharmacist/app/auth/sign-in/actions.ts")).toContain(
      "/pharmacist/auth/callback",
    );
    expect(read("apps/pharmacy/app/auth/sign-in/actions.ts")).toContain(
      "/pharmacy/auth/callback",
    );

    const representativeClients = [
      "apps/admin/components/medicine-form.tsx",
      "apps/patient/components/inventory-search.tsx",
      "apps/pharmacist/components/decision-form.tsx",
      "apps/pharmacy/components/inventory-dashboard.tsx",
    ];
    for (const path of representativeClients) {
      expect(read(path), path).not.toMatch(/fetch\((?:"|'|`)\/api\//);
    }
  });
});
