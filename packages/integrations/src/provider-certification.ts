export type ProductionProvider =
  | "email"
  | "messaging"
  | "payment"
  | "storage"
  | "maps"
  | "ai";

export interface ProviderCertificationEvidence {
  readonly provider: ProductionProvider;
  readonly profile: string;
  readonly environment: "staging" | "production";
  readonly external: boolean;
  readonly executedAt: Date;
  readonly expiresAt: Date;
  readonly connectivity: boolean;
  readonly authentication: boolean;
  readonly timeout: boolean;
  readonly retry: boolean;
  readonly circuitBreaker: boolean;
  readonly fallback: boolean;
  readonly auditLogging: boolean;
}

export function certifyProviders(
  required: readonly ProductionProvider[],
  evidence: readonly ProviderCertificationEvidence[],
  now: Date,
): {
  readonly passed: boolean;
  readonly missing: readonly ProductionProvider[];
  readonly failed: readonly ProductionProvider[];
} {
  const complete = (item: ProviderCertificationEvidence) =>
    item.external
    && item.environment === "production"
    && item.executedAt <= now
    && item.expiresAt > now
    && item.connectivity
    && item.authentication
    && item.timeout
    && item.retry
    && item.circuitBreaker
    && item.fallback
    && item.auditLogging;
  const missing = required.filter((provider) =>
    !evidence.some((item) => item.provider === provider && item.external)
  );
  const failed = required.filter((provider) =>
    evidence.some((item) => item.provider === provider && item.external)
    && !evidence.some((item) => item.provider === provider && complete(item))
  );
  return { passed: missing.length === 0 && failed.length === 0, missing, failed };
}
