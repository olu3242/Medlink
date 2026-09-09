import { afterEach, describe, expect, it } from "vitest";

import { resolveServerOrigin } from "./server-origin";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("server origin resolution", () => {
  it("gives an explicit trusted origin precedence", () => {
    process.env.MEDLINK_PUBLIC_ORIGIN = "https://preview.medlink.example/";
    process.env.VERCEL_BRANCH_URL = "branch.vercel.app";
    expect(resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN"], "http://localhost:3024", "callbacks", "https://request.vercel.app")).toBe("https://preview.medlink.example");
  });

  it("uses stable branch and deployment origins before a request fallback", () => {
    delete process.env.MEDLINK_PUBLIC_ORIGIN;
    process.env.VERCEL_BRANCH_URL = "medlink-git-feature-team.vercel.app";
    process.env.VERCEL_URL = "medlink-random.vercel.app";
    expect(resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN"], "http://localhost:3024", "callbacks", "https://request.vercel.app")).toBe("https://medlink-git-feature-team.vercel.app");
  });

  it("accepts only a safe hosted request fallback", () => {
    delete process.env.MEDLINK_PUBLIC_ORIGIN;
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
    process.env.VERCEL = "1";
    expect(resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN"], "http://localhost:3024", "callbacks", "https://medlink-preview.vercel.app")).toBe("https://medlink-preview.vercel.app");
    expect(() => resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN"], "http://localhost:3024", "callbacks", "https://evil.example")).toThrow(/required for hosted/);
  });

  it("uses localhost outside hosted runtime and rejects malformed explicit configuration", () => {
    delete process.env.MEDLINK_PUBLIC_ORIGIN;
    delete process.env.VERCEL_BRANCH_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL;
    expect(resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN"], "http://localhost:3024", "callbacks")).toBe("http://localhost:3024");
    process.env.MEDLINK_PUBLIC_ORIGIN = "javascript:alert(1)";
    expect(() => resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN"], "http://localhost:3024", "callbacks")).toThrow(/valid HTTP\(S\) origin/);
  });
});
