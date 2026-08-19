import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  readonly name?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

interface PackageLock {
  readonly packages: Readonly<
    Record<string, { readonly dependencies?: Readonly<Record<string, string>> }>
  >;
}

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const appsRoot = join(repositoryRoot, "apps");
const requiredRuntimeDependencies = ["next", "react", "react-dom"] as const;
const nextCommand = /(?:^|\s)next\s+(?:build|dev|start)(?:\s|$)/;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("Vercel monorepo deployment contract", () => {
  const rootManifest = readJson<PackageManifest>(join(repositoryRoot, "package.json"));
  const lockfile = readJson<PackageLock>(join(repositoryRoot, "package-lock.json"));
  const nextApplications = readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(appsRoot, entry.name);
      const manifest = readJson<PackageManifest>(join(directory, "package.json"));
      return { directory, manifest };
    })
    .filter(({ manifest }) => Object.values(manifest.scripts ?? {}).some((script) => nextCommand.test(script)));

  it("makes every Next.js application independently framework-detectable", () => {
    expect(nextApplications.map(({ manifest }) => manifest.name).sort()).toEqual([
      "@medlink/admin",
      "@medlink/dashboard-app",
      "@medlink/developer-app",
      "@medlink/patient-app",
      "@medlink/pharmacist-app",
      "@medlink/pharmacy-app",
      "@medlink/provider-app",
      "@medlink/web",
    ]);

    for (const { manifest } of nextApplications) {
      for (const dependency of requiredRuntimeDependencies) {
        expect(
          manifest.dependencies?.[dependency],
          `${manifest.name} must declare ${dependency} directly for Vercel detection`,
        ).toBe(rootManifest.dependencies?.[dependency]);
      }
    }
  });

  it("records each application dependency contract in the npm workspace lockfile", () => {
    for (const { directory, manifest } of nextApplications) {
      const lockfilePath = relative(repositoryRoot, directory).replaceAll("\\", "/");
      const lockedDependencies = lockfile.packages[lockfilePath]?.dependencies;
      for (const dependency of requiredRuntimeDependencies) {
        expect(lockedDependencies?.[dependency], `${manifest.name} lockfile ${dependency}`).toBe(
          manifest.dependencies?.[dependency],
        );
      }
    }
  });

  it("uses one hoisted Next.js installation instead of conflicting application copies", () => {
    const nextInstallations = Object.keys(lockfile.packages).filter(
      (path) => path === "node_modules/next" || path.endsWith("/node_modules/next"),
    );
    expect(nextInstallations).toEqual(["node_modules/next"]);
  });
});
