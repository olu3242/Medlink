import { partnerDecisionSchema } from "@medlink/partner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { applicationIdSchema, correlationId, idempotencyKey, jsonBody, partnerDatabaseProblem, partnerProblem, partnerRpc, runWebApi } from "../../../../../../../lib/partner";

type Context = { params: Promise<{ id: string; action: string }> };
const versioned = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().max(2000).default(""), idempotencyKey: z.string().min(8).optional() });
const verification = z.object({ subjectType: z.enum(["identity","qualification","compliance"]), subjectId: z.string().uuid().nullable().optional(), status: z.enum(["pending","verified","failed","expired"]), evidenceReference: z.string().max(500).optional(), evidenceDigest: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(), notes: z.string().max(2000).optional(), idempotencyKey: z.string().min(8).optional() });
const agreement = z.object({ agreementType: z.string().min(2).max(80).default("partner_terms"), version: z.string().min(1).max(80), documentReference: z.string().min(1).max(500), documentDigest: z.string().regex(/^[A-Fa-f0-9]{64}$/), idempotencyKey: z.string().min(8).optional() });
const acceptance = z.object({ agreementId: z.string().uuid(), idempotencyKey: z.string().min(8).optional() });
const integration = z.object({ providerKind: z.string().min(2).max(80), endpointOrigin: z.string().url().startsWith("https://").nullable().optional(), capabilities: z.array(z.string().min(1).max(80)).max(30).default([]), status: z.enum(["not_started","not_required","planning","testing","certified","suspended"]), idempotencyKey: z.string().min(8).optional() });
const qualification = z.object({ qualificationType: z.string().min(2).max(100), issuer: z.string().max(200).optional(), reference: z.string().max(200).optional(), documentReference: z.string().max(500).optional(), documentDigest: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(), expiresAt: z.string().date().optional(), idempotencyKey: z.string().min(8).optional() });
const locationCapability = z.object({ locationId:z.string().uuid(),credentialStatus:z.enum(["pending","verified","failed","expired"]),inventoryIntegrationStatus:z.enum(["unknown","healthy","degraded","failed"]),inventoryFreshnessStatus:z.enum(["unknown","current","stale","source_unavailable"]),medicationMappingStatus:z.enum(["unknown","eligible","blocked","ambiguous"]),paymentCapabilityStatus:z.enum(["unknown","ready","degraded","failed"]),fulfillmentCapabilityStatus:z.enum(["unknown","ready","degraded","failed"]),freshnessPolicyReference:z.string().min(1).max(500).nullable().optional(),sourceUpdatedAt:z.string().datetime().nullable().optional(),lastSuccessfulSync:z.string().datetime().nullable().optional(),evidenceReference:z.string().min(1).max(500),evidenceDigest:z.string().regex(/^[A-Fa-f0-9]{64}$/).nullable().optional(),idempotencyKey:z.string().min(8).optional() });

export async function POST(request: Request, context: Context) {
  return runWebApi(request,async(database)=>{
  const params = await context.params;
  const id = applicationIdSchema.safeParse(params.id);
  if (!id.success) return partnerProblem(400, "invalid_application_id", "A valid application ID is required");
  const raw = await jsonBody(request);
  const correlation = correlationId(request);
  let result: { data: unknown; error: { message: string } | null };
  if (params.action === "submit") {
    const body = versioned.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_submission","Expected application version is required");
    result = await partnerRpc(database,"submit_partner_application", { target_application_id:id.data,target_expected_version:body.data.expectedVersion,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "decision") {
    const body = partnerDecisionSchema.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_decision","Review the partner decision");
    result = await partnerRpc(database,"decide_partner_application", { target_application_id:id.data,target_decision:body.data.decision,target_reason:body.data.reason,target_existing_organization_id:body.data.existingOrganizationId ?? null,target_expected_version:body.data.expectedVersion,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "verification") {
    const body = verification.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_verification","Review the verification evidence");
    result = await partnerRpc(database,"record_partner_verification", { target_application_id:id.data,target_subject_type:body.data.subjectType,target_subject_id:body.data.subjectId ?? null,target_status:body.data.status,target_evidence_reference:body.data.evidenceReference ?? null,target_evidence_digest:body.data.evidenceDigest ?? null,target_notes:body.data.notes ?? null,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "qualification") {
    const body = qualification.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_qualification","Review the qualification evidence");
    result = await partnerRpc(database,"add_partner_qualification", { target_application_id:id.data,target_qualification_type:body.data.qualificationType,target_issuer:body.data.issuer ?? null,target_reference:body.data.reference ?? null,target_document_reference:body.data.documentReference ?? null,target_document_digest:body.data.documentDigest ?? null,target_expires_at:body.data.expiresAt ?? null,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "agreement") {
    const body = agreement.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_agreement","Review the governed agreement reference");
    result = await partnerRpc(database,"issue_partner_agreement", { target_application_id:id.data,target_agreement_type:body.data.agreementType,target_version:body.data.version,target_document_reference:body.data.documentReference,target_document_digest:body.data.documentDigest,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "accept-agreement") {
    const body = acceptance.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_agreement_acceptance","A valid agreement is required");
    result = await partnerRpc(database,"accept_partner_agreement", { target_application_id:id.data,target_agreement_id:body.data.agreementId,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "integration") {
    const body = integration.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_integration_profile","Review the integration profile");
    result = await partnerRpc(database,"update_partner_integration", { target_application_id:id.data,target_provider_kind:body.data.providerKind,target_endpoint_origin:body.data.endpointOrigin ?? null,target_capabilities:body.data.capabilities,target_status:body.data.status,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else if (params.action === "readiness") {
    result = await partnerRpc(database,"assess_partner_readiness", { target_application_id:id.data });
  } else if (params.action === "location-capability") {
    const body=locationCapability.safeParse(raw); if(!body.success) return partnerProblem(400,"invalid_location_capability","Review the location capability evidence");
    result=await partnerRpc(database,"record_partner_location_capability",{target_application_id:id.data,target_location_id:body.data.locationId,target_credential_status:body.data.credentialStatus,target_inventory_integration_status:body.data.inventoryIntegrationStatus,target_inventory_freshness_status:body.data.inventoryFreshnessStatus,target_medication_mapping_status:body.data.medicationMappingStatus,target_payment_capability_status:body.data.paymentCapabilityStatus,target_fulfillment_capability_status:body.data.fulfillmentCapabilityStatus,target_freshness_policy_reference:body.data.freshnessPolicyReference ?? null,target_source_updated_at:body.data.sourceUpdatedAt ?? null,target_last_successful_sync:body.data.lastSuccessfulSync ?? null,target_evidence_reference:body.data.evidenceReference,target_evidence_digest:body.data.evidenceDigest ?? null,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation});
  } else if (params.action === "location-readiness") {
    const body=z.object({locationId:z.string().uuid()}).safeParse(raw); if(!body.success) return partnerProblem(400,"invalid_location_id","A valid pharmacy location is required");
    result=await partnerRpc(database,"partner_location_network_state",{target_location_id:body.data.locationId});
  } else if (["activate","suspend","deactivate","terminate"].includes(params.action)) {
    const body = versioned.safeParse(raw); if (!body.success) return partnerProblem(400,"invalid_transition","Expected version and lifecycle reason are required");
    result = await partnerRpc(database,"transition_partner_relationship", { target_application_id:id.data,target_transition:params.action,target_reason:body.data.reason,target_expected_version:body.data.expectedVersion,target_idempotency_key:idempotencyKey(request,body.data.idempotencyKey),target_correlation_id:correlation });
  } else return partnerProblem(404,"partner_action_not_found","The partner action does not exist");
  if (result.error) return partnerDatabaseProblem(result.error.message);
  return NextResponse.json({ result: result.data });
  });
}
