export type ExerciseKind =
  | "performance"
  | "penetration"
  | "backup"
  | "restore"
  | "disaster_recovery";

export interface ExerciseResult {
  readonly kind: ExerciseKind;
  readonly passed: boolean;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}

export interface Exercise {
  readonly kind: ExerciseKind;
  execute(): Promise<ExerciseResult>;
}

export class ExerciseSuite {
  constructor(private readonly required: readonly ExerciseKind[]) {}

  async run(exercises: readonly Exercise[]): Promise<{
    passed: boolean;
    results: readonly ExerciseResult[];
    missing: readonly ExerciseKind[];
  }> {
    const results = await Promise.all(exercises.map((exercise) => exercise.execute()));
    const missing = this.required.filter(
      (kind) => !results.some((result) => result.kind === kind),
    );
    return {
      passed: missing.length === 0 && results.every((result) => result.passed),
      results,
      missing,
    };
  }
}

export interface BackupManifest {
  readonly backupId: string;
  readonly createdAt: Date;
  readonly sourceEnvironment: string;
  readonly sha256: string;
  readonly encrypted: boolean;
  readonly objectCount: number;
}

export function verifyRestore(input: {
  manifest: BackupManifest;
  restoredSha256: string;
  restoredObjectCount: number;
}): { passed: boolean; reason?: string } {
  if (!input.manifest.encrypted) return { passed: false, reason: "backup_not_encrypted" };
  if (input.manifest.sha256 !== input.restoredSha256) {
    return { passed: false, reason: "integrity_mismatch" };
  }
  if (input.manifest.objectCount !== input.restoredObjectCount) {
    return { passed: false, reason: "object_count_mismatch" };
  }
  return { passed: true };
}
