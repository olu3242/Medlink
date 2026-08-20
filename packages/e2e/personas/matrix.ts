export const memberRoles = [
  "platform_admin",
  "tenant_admin",
  "pharmacist",
  "provider",
  "pharmacy_owner",
  "pharmacy_staff",
  "inventory_manager",
  "patient",
] as const;

export type MemberRole = typeof memberRoles[number];
export type PersonaName =
  | "patient"
  | "pharmacy_owner"
  | "pharmacy_staff"
  | "pharmacist"
  | "inventory_manager"
  | "provider"
  | "partner_applicant"
  | "partner_reviewer"
  | "tenant_admin"
  | "platform_admin"
  | "finance"
  | "alice"
  | "whatsapp_user";

export interface PersonaDefinition {
  readonly identityType: "supabase_user" | "channel_linked_user";
  readonly membershipRole: MemberRole | null;
  readonly allowedApps: readonly string[];
  readonly primaryWorkflows: readonly string[];
  readonly forbiddenWorkflows: readonly string[];
  readonly implementation: "implemented" | "foundation_only" | "not_implemented";
}

export const personaMatrix: Record<PersonaName, PersonaDefinition> = {
  patient: {
    identityType: "supabase_user", membershipRole: "patient",
    allowedApps: ["patient"],
    primaryWorkflows: ["authentication", "discovery", "prescription", "reservation", "payment", "tracking"],
    forbiddenWorkflows: ["clinical_decision", "inventory_authority"], implementation: "implemented",
  },
  pharmacy_owner: {
    identityType: "supabase_user", membershipRole: "pharmacy_owner",
    allowedApps: ["web", "pharmacy"], primaryWorkflows: ["partner_onboarding", "location_management"],
    forbiddenWorkflows: ["self_verification"], implementation: "implemented",
  },
  pharmacy_staff: {
    identityType: "supabase_user", membershipRole: "pharmacy_staff",
    allowedApps: ["pharmacy"], primaryWorkflows: ["reservation_decision", "fulfillment"],
    forbiddenWorkflows: ["clinical_decision", "tenant_administration"], implementation: "implemented",
  },
  pharmacist: {
    identityType: "supabase_user", membershipRole: "pharmacist",
    allowedApps: ["pharmacist"], primaryWorkflows: ["prescription_review", "clinical_decision"],
    forbiddenWorkflows: ["cross_tenant_review"], implementation: "implemented",
  },
  inventory_manager: {
    identityType: "supabase_user", membershipRole: "inventory_manager",
    allowedApps: ["pharmacy"], primaryWorkflows: ["inventory_management"],
    forbiddenWorkflows: ["clinical_decision"], implementation: "foundation_only",
  },
  provider: {
    identityType: "supabase_user", membershipRole: "provider",
    allowedApps: ["provider"], primaryWorkflows: ["prescription_authoring", "referral_authoring"],
    forbiddenWorkflows: ["pharmacy_fulfillment"], implementation: "foundation_only",
  },
  partner_applicant: {
    identityType: "supabase_user", membershipRole: null,
    allowedApps: ["web"], primaryWorkflows: ["partner_application"],
    forbiddenWorkflows: ["partner_review", "self_approval"], implementation: "implemented",
  },
  partner_reviewer: {
    identityType: "supabase_user", membershipRole: "platform_admin",
    allowedApps: ["web"], primaryWorkflows: ["partner_review", "partner_activation"],
    forbiddenWorkflows: ["self_approval"], implementation: "implemented",
  },
  tenant_admin: {
    identityType: "supabase_user", membershipRole: "tenant_admin",
    allowedApps: ["dashboard", "admin"], primaryWorkflows: ["tenant_governance"],
    forbiddenWorkflows: ["platform_governance"], implementation: "foundation_only",
  },
  platform_admin: {
    identityType: "supabase_user", membershipRole: "platform_admin",
    allowedApps: ["admin", "dashboard", "web"], primaryWorkflows: ["platform_governance"],
    forbiddenWorkflows: ["self_approval"], implementation: "foundation_only",
  },
  finance: {
    identityType: "supabase_user", membershipRole: "platform_admin",
    allowedApps: ["dashboard"], primaryWorkflows: ["refund", "settlement", "reconciliation"],
    forbiddenWorkflows: ["clinical_decision"], implementation: "foundation_only",
  },
  alice: {
    identityType: "supabase_user", membershipRole: "patient",
    allowedApps: ["patient"], primaryWorkflows: ["authorized_assistance", "governed_handoff"],
    forbiddenWorkflows: ["diagnosis", "prescribing", "unauthorized_tool_execution"], implementation: "implemented",
  },
  whatsapp_user: {
    identityType: "channel_linked_user", membershipRole: "patient",
    allowedApps: ["whatsapp", "patient"], primaryWorkflows: ["signed_discovery", "channel_handoff"],
    forbiddenWorkflows: ["unsigned_execution"], implementation: "implemented",
  },
};
