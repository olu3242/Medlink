import { describe, expect, it } from "vitest";
import { ExerciseSuite, verifyRestore, type ExerciseKind } from "./exercises";

describe("production exercises", () => {
  it("requires every performance, security, backup, restore, and DR result", async () => {
    const required: ExerciseKind[] = [
      "performance", "penetration", "backup", "restore", "disaster_recovery",
    ];
    const suite = new ExerciseSuite(required);
    const result = await suite.run(required.map((kind) => ({
      kind,
      execute: async () => ({
        kind,
        passed: true,
        startedAt: new Date(),
        completedAt: new Date(),
        evidence: { artifact: `${kind}.json` },
      }),
    })));
    expect(result).toMatchObject({ passed: true, missing: [] });
  });

  it("verifies encrypted restore integrity and record count", () => {
    expect(verifyRestore({
      manifest: {
        backupId: "backup-1",
        createdAt: new Date(),
        sourceEnvironment: "staging",
        sha256: "abc",
        encrypted: true,
        objectCount: 50,
      },
      restoredSha256: "abc",
      restoredObjectCount: 50,
    })).toEqual({ passed: true });
  });
});
