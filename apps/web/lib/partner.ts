import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseServerClient } from "./supabase/server";

export async function partnerRequest(request: Request) {
  void request;
  const database = await createSupabaseServerClient();
  const { data, error } = await database.auth.getUser();
  if (error || !data.user) {
    return { response: partnerProblem(401, "authentication_required", "Authentication is required"), database: null, user: null };
  }
  return { response: null, database, user: data.user };
}

// Canonical pre-tenant web runtime boundary. Partner applicants are real
// authenticated users but intentionally have no organization membership
// until identity resolution; runApi therefore cannot resolve their tenant.
export async function runWebApi(request: Request, handler: (database: SupabaseClient) => Promise<Response>) {
  const access=await partnerRequest(request);
  if(access.response) return access.response;
  return handler(access.database);
}

export function partnerRpc(database: SupabaseClient, name: string, args: Record<string, unknown>) {
  return database.rpc(name, args);
}

export function listPartnerApplications(database: SupabaseClient) {
  return database.from("partner_applications")
    .select("id,public_reference,legal_name,trading_name,partner_type,relationship_status,onboarding_stage,integration_status,organization_id,version,updated_at")
    .is("deleted_at", null).order("updated_at", { ascending: false });
}

export function getPartnerApplication(database: SupabaseClient, id: string) {
  return database.from("partner_applications").select(`
    *,partner_contacts(*),partner_identity_claims(*),partner_qualifications(*),
    partner_requirements(*),partner_agreements(*),partner_integration_profiles(*),
    partner_readiness_assessments(*),partner_status_history(*)
  `).eq("id",id).single();
}

export function correlationId(request: Request) {
  return request.headers.get("x-correlation-id") ?? crypto.randomUUID();
}

export function idempotencyKey(request: Request, fallback?: string) {
  return request.headers.get("idempotency-key") ?? fallback ?? crypto.randomUUID();
}

export function partnerProblem(status: number, code: string, detail: string) {
  return NextResponse.json({ type: "about:blank", title: code, status, detail }, { status });
}

export function partnerDatabaseProblem(message: string) {
  if (/stale/i.test(message)) return partnerProblem(409, "stale_version", "The application changed; refresh and try again");
  if (/duplicate|unique/i.test(message)) return partnerProblem(409, "duplicate_identity", "This partner identity is already in use");
  if (/access denied|role required|self-|prohibited/i.test(message)) return partnerProblem(403, "partner_access_denied", "This partner operation is not permitted");
  if (/not found/i.test(message)) return partnerProblem(404, "partner_not_found", "The partner application was not found");
  return partnerProblem(422, "partner_operation_rejected", message.replace(/^.*?:\s*/, "").slice(0, 240));
}

export async function jsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new z.ZodError([]); }
}

export const applicationIdSchema = z.string().uuid();
