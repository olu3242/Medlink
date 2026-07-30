export type PartnerType =
  | "pharmacy" | "hospital" | "laboratory" | "insurer" | "manufacturer"
  | "distributor" | "logistics" | "regulator" | "technology";
export type TrustLevel = "registered" | "verified" | "certified" | "trusted" | "strategic";

export interface EcosystemPartner {
  readonly id: string;
  readonly type: PartnerType;
  readonly tenantId: string;
  readonly trustLevel: TrustLevel;
  readonly slaCompliance: number;
  readonly apiQuality: number;
  readonly securityPosture: number;
  readonly uptime: number;
  readonly operationalIncidents: number;
  readonly certificationExpiresAt: Date;
  readonly auditCompleted: boolean;
  readonly evidenceSha256: string;
}

export function evaluatePartnerTrust(
  partner: EcosystemPartner,
  now: Date,
  mandatoryThreshold: number,
): {
  readonly score: number;
  readonly status: "active" | "suspended";
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (partner.certificationExpiresAt <= now) reasons.push("certification_expired");
  if (!partner.auditCompleted) reasons.push("audit_incomplete");
  if (!/^[a-f0-9]{64}$/i.test(partner.evidenceSha256)) reasons.push("evidence_invalid");
  const score = Math.round(
    (partner.slaCompliance + partner.apiQuality + partner.securityPosture
      + partner.uptime) / 4 - Math.min(30, partner.operationalIncidents * 2),
  );
  if (score < mandatoryThreshold) reasons.push("trust_threshold_failed");
  return { score, status: reasons.length ? "suspended" : "active", reasons };
}
