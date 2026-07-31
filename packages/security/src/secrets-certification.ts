export type SecretSource = "github_actions" | "supabase_vault" | "runtime";
export type SecretValidation = "valid" | "invalid" | "unverified";

export interface SecretEvidence {
  readonly name: string;
  readonly environment: "development" | "qa" | "staging" | "production";
  readonly source: SecretSource;
  readonly present: boolean;
  readonly validation: SecretValidation;
  readonly expiresAt: Date;
  readonly lastRotatedAt: Date;
  readonly rotationDays: number;
  readonly plaintextInRepository: boolean;
  readonly leaked: boolean;
}

export function certifySecrets(
  evidence: readonly SecretEvidence[],
  requiredProductionSecrets: readonly string[],
  now: Date,
): {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly expiring: readonly string[];
} {
  const production = evidence.filter(({ environment }) => environment === "production");
  const failures = new Set<string>();
  const seen = new Set<string>();
  for (const secret of evidence) {
    const identity = `${secret.environment}:${secret.name}`;
    if (seen.has(identity)) failures.add(`duplicate:${identity}`);
    seen.add(identity);
    if (!secret.present) failures.add(`missing:${identity}`);
    if (secret.validation !== "valid") failures.add(`${secret.validation}:${identity}`);
    if (secret.expiresAt <= now) failures.add(`expired:${identity}`);
    if (secret.plaintextInRepository) failures.add(`plaintext:${identity}`);
    if (secret.leaked) failures.add(`leaked:${identity}`);
    const rotationDue = new Date(secret.lastRotatedAt);
    rotationDue.setUTCDate(rotationDue.getUTCDate() + secret.rotationDays);
    if (rotationDue <= now) failures.add(`rotation_overdue:${identity}`);
  }
  for (const name of requiredProductionSecrets) {
    if (!production.some((secret) => secret.name === name && secret.present)) {
      failures.add(`missing:production:${name}`);
    }
  }
  const expiring = production
    .filter(({ expiresAt }) => expiresAt > now && expiresAt.getTime() - now.getTime() <= 604_800_000)
    .map(({ name }) => name);
  return { passed: failures.size === 0, failures: [...failures], expiring };
}
