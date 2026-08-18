import { z } from "zod";

export const partnerTypes = [
  "pharmacy", "pharmacy_chain", "manufacturer", "distributor", "wholesaler",
  "healthcare_provider", "hospital_clinic", "payer_insurer", "logistics",
  "technology_api", "government_regulator", "other",
] as const;

export const relationshipStatuses = [
  "prospect", "applicant", "under_review", "needs_information", "approved",
  "active", "suspended", "inactive", "terminated", "rejected",
] as const;

export const onboardingStages = [
  "application", "identity", "qualification", "compliance", "agreement",
  "integration", "activation", "complete",
] as const;

export const integrationStatuses = [
  "not_started", "not_required", "planning", "testing", "certified", "suspended",
] as const;

export const partnerTypeSchema = z.enum(partnerTypes);
export const relationshipStatusSchema = z.enum(relationshipStatuses);
export const onboardingStageSchema = z.enum(onboardingStages);
export const integrationStatusSchema = z.enum(integrationStatuses);

export type PartnerType = z.infer<typeof partnerTypeSchema>;
export type RelationshipStatus = z.infer<typeof relationshipStatusSchema>;
export type OnboardingStage = z.infer<typeof onboardingStageSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const createPartnerApplicationSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().min(2).max(200).optional(),
  partnerType: partnerTypeSchema,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  website: z.string().url().max(500).optional(),
  summary: z.string().trim().min(20).max(2000),
  contact: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().email().max(320),
    phone: z.string().trim().min(7).max(40).optional(),
    title: z.string().trim().max(120).optional(),
  }),
  identity: z.object({
    scheme: z.string().trim().min(2).max(80),
    value: z.string().trim().min(2).max(160),
  }),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const updatePartnerApplicationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  tradingName: z.string().trim().min(2).max(200).nullable().optional(),
  website: z.string().url().max(500).nullable().optional(),
  summary: z.string().trim().min(20).max(2000).optional(),
});

export const partnerDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "request_information"]),
  reason: z.string().trim().min(10).max(2000),
  existingOrganizationId: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export interface ReadinessInput {
  relationshipStatus: RelationshipStatus;
  acceptedAgreement: boolean;
  allRequirementsSatisfied: boolean;
  integrationStatus: IntegrationStatus;
  activePharmacyLocations?: number;
  partnerType: PartnerType;
}

export function evaluateReadiness(input: ReadinessInput) {
  const blockers: string[] = [];
  if (input.relationshipStatus !== "approved") blockers.push("relationship_not_approved");
  if (!input.acceptedAgreement) blockers.push("agreement_not_accepted");
  if (!input.allRequirementsSatisfied) blockers.push("requirements_incomplete");
  if (!["certified", "not_required"].includes(input.integrationStatus)) {
    blockers.push("integration_not_certified");
  }
  if (["pharmacy", "pharmacy_chain"].includes(input.partnerType)
    && (input.activePharmacyLocations ?? 0) < 1) {
    blockers.push("active_pharmacy_location_required");
  }
  return { ready: blockers.length === 0, blockers } as const;
}

export const providerExtensionContract = {
  version: "partner-provider.v1",
  requiredCapabilities: ["identity", "status", "health"],
  optionalCapabilities: ["catalog", "inventory", "orders", "webhooks"],
} as const;

export function partnerHandoff(partnerType: PartnerType, organizationId: string) {
  if (["pharmacy", "pharmacy_chain"].includes(partnerType)) {
    return { authority: "pharmacy_locations", href: "/locations", organizationId } as const;
  }
  if (partnerType === "manufacturer") {
    return { authority: "merdp_manufacturer_source_links", organizationId } as const;
  }
  return { authority: "partner-provider.v1", contract: providerExtensionContract, organizationId } as const;
}
