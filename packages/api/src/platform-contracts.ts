export type ContractAudience =
  | "frontend" | "backend" | "mobile" | "external_partner" | "internal_team";

export interface PlatformContract {
  readonly id: string;
  readonly audience: ContractAudience;
  readonly version: string;
  readonly minimumCompatibleVersion: string;
  readonly schemaSha256: string;
  readonly deprecated: boolean;
  readonly replacementId?: string;
}

function parseVersion(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error("Contract version must use semantic versioning");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function assessContractCompatibility(
  published: PlatformContract,
  requestedVersion: string,
): {
  readonly compatible: boolean;
  readonly guarantee: "same_major_additive_only";
  readonly reason?: string;
} {
  const current = parseVersion(published.version);
  const minimum = parseVersion(published.minimumCompatibleVersion);
  const requested = parseVersion(requestedVersion);
  if (!/^[a-f0-9]{64}$/i.test(published.schemaSha256)) {
    return { compatible: false, guarantee: "same_major_additive_only", reason: "schema_invalid" };
  }
  const compatible = requested[0] === current[0]
    && requested[0] === minimum[0]
    && requested[1] >= minimum[1]
    && (requested[1] < current[1]
      || (requested[1] === current[1] && requested[2] <= current[2]));
  return compatible
    ? { compatible: true, guarantee: "same_major_additive_only" }
    : {
        compatible: false,
        guarantee: "same_major_additive_only",
        reason: "version_outside_compatibility_range",
      };
}
