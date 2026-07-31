import { describe, expect, it } from "vitest";
import { releaseBlockingAdvisories, scanSource } from "./assurance";

describe("security assurance", () => {
  it("detects embedded secrets, private keys, and insecure external URLs", () => {
    const findings = scanSource([
      { path: "config.ts", content: 'const apiKey = "12345678901234567890";' },
      { path: "key.pem", content: "-----BEGIN PRIVATE KEY-----" },
      { path: "client.ts", content: 'fetch("http://example.test")' },
    ]);
    expect(findings.map(({ rule }) => rule)).toEqual([
      "embedded_secret", "private_key", "unsafe_url",
    ]);
  });

  it("blocks high and critical production dependency advisories", () => {
    expect(releaseBlockingAdvisories([
      { package: "a", severity: "moderate", production: true },
      { package: "b", severity: "high", production: true },
      { package: "c", severity: "critical", production: false },
    ]).map(({ package: name }) => name)).toEqual(["b"]);
  });
});
