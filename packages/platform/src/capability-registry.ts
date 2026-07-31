export type CapabilityMaturity = "experimental" | "emerging" | "stable" | "certified";

export interface PlatformCapability {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly maturity: CapabilityMaturity;
  readonly certificationStatus: "uncertified" | "degraded" | "certified";
  readonly runtimeDependencies: readonly string[];
  readonly apiDependencies: readonly string[];
  readonly dataDependencies: readonly string[];
  readonly operationalReadiness: "not_ready" | "conditional" | "ready";
  readonly evidenceSha256?: string;
}

export function validateCapabilityRegistry(
  capabilities: readonly PlatformCapability[],
): readonly string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const capability of capabilities) {
    if (ids.has(capability.id)) issues.push(`duplicate:${capability.id}`);
    ids.add(capability.id);
    if (!capability.ownerId) issues.push(`owner_missing:${capability.id}`);
    if (capability.maturity === "certified"
      && (capability.certificationStatus !== "certified"
        || capability.operationalReadiness !== "ready"
        || !/^[a-f0-9]{64}$/i.test(capability.evidenceSha256 ?? ""))) {
      issues.push(`certification_invalid:${capability.id}`);
    }
  }
  return issues;
}

export function traceCapability(
  capabilityId: string,
  capabilities: readonly PlatformCapability[],
): {
  readonly capability?: PlatformCapability;
  readonly dependencies: readonly string[];
} {
  const capability = capabilities.find((item) => item.id === capabilityId);
  if (!capability) return { dependencies: [] };
  return {
    capability,
    dependencies: [
      ...capability.runtimeDependencies,
      ...capability.apiDependencies,
      ...capability.dataDependencies,
    ],
  };
}
