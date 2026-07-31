export const runtimeProfileIds = [
  "api",
  "background",
  "ai",
  "administrative",
  "conversation",
] as const;

export type RuntimeProfileId = (typeof runtimeProfileIds)[number];

export interface RuntimeProfileCapabilities {
  authenticatedContext: boolean;
  tenantIsolation: boolean;
  authorization: boolean;
  structuredLogging: boolean;
  durableMetrics: boolean;
  distributedTracing: boolean;
  dependencyHealth: boolean;
  durableDiagnostics: boolean;
  immutableEvidence: boolean;
  humanEscalation: boolean;
  idempotency: boolean;
}

export interface RuntimeProfileResult {
  profile: RuntimeProfileId;
  passed: boolean;
  required: readonly (keyof RuntimeProfileCapabilities)[];
  missing: readonly (keyof RuntimeProfileCapabilities)[];
}

export interface RuntimeProfileEvidence {
  readonly profile: RuntimeProfileId;
  readonly capabilities: RuntimeProfileCapabilities;
  readonly artifactSha256: string;
  readonly observedAt: Date;
  readonly environment: string;
}

const common: readonly (keyof RuntimeProfileCapabilities)[] = [
  "authenticatedContext",
  "tenantIsolation",
  "authorization",
  "structuredLogging",
  "durableMetrics",
  "distributedTracing",
  "dependencyHealth",
  "durableDiagnostics",
  "immutableEvidence",
  "idempotency",
];

const requirements: Readonly<Record<
  RuntimeProfileId,
  readonly (keyof RuntimeProfileCapabilities)[]
>> = {
  api: common,
  background: common.filter((item) =>
    item !== "authenticatedContext" && item !== "authorization"),
  ai: [...common, "humanEscalation"],
  administrative: common,
  conversation: [...common, "humanEscalation"],
};

export function certifyRuntimeProfiles(
  capabilities: RuntimeProfileCapabilities,
): readonly RuntimeProfileResult[] {
  return runtimeProfileIds.map((profile) => {
    const required = requirements[profile];
    const missing = required.filter((capability) => !capabilities[capability]);
    return { profile, passed: missing.length === 0, required, missing };
  });
}

export function certifyRuntimeProfileEvidence(
  evidence: readonly RuntimeProfileEvidence[],
): readonly (RuntimeProfileResult & {
  artifactSha256?: string;
  observedAt?: Date;
  environment?: string;
})[] {
  return runtimeProfileIds.map((profile) => {
    const item = evidence.find((candidate) => candidate.profile === profile);
    if (!item) {
      return {
        profile,
        passed: false,
        required: requirements[profile],
        missing: requirements[profile],
      };
    }
    const missing = requirements[profile].filter(
      (capability) => !item.capabilities[capability],
    );
    return {
      profile,
      passed: missing.length === 0 && /^[a-f0-9]{64}$/.test(item.artifactSha256),
      required: requirements[profile],
      missing,
      artifactSha256: item.artifactSha256,
      observedAt: item.observedAt,
      environment: item.environment,
    };
  });
}
