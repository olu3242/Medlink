import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("API architecture", () => {
  const apps = join(process.cwd(), "apps");
  const routes = files(apps).filter((path) =>
    !path.includes(`${join(".next", "types")}`)
    && path.includes(`${join("api", "v1")}`)
    && path.endsWith("route.ts"),
  );

  it("migrates every protected v1 route to the canonical runtime", () => {
    const violations = routes
      .filter((path) => !path.endsWith(join("health", "route.ts")))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return !source.includes("runApi") && !source.includes("runWebApi");
      })
      .map((path) => relative(process.cwd(), path));
    expect(violations).toEqual([]);
  });

  it("keeps persistence and direct authentication out of route handlers", () => {
    const violations = routes.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return source.match(/\.from\(|\.rpc\(|auth\.getUser/g)
        ? [relative(process.cwd(), path)]
        : [];
    });
    expect(violations).toEqual([]);
  });
});
