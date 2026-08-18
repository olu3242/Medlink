import { createPartnerApplicationSchema } from "@medlink/partner";
import { NextResponse } from "next/server";
import { correlationId, idempotencyKey, jsonBody, listPartnerApplications, partnerDatabaseProblem, partnerProblem, partnerRpc, runWebApi } from "../../../../../lib/partner";

export async function GET(request: Request) {
  return runWebApi(request,async(database)=>{const {data,error}=await listPartnerApplications(database);
    if(error)return partnerDatabaseProblem(error.message);return NextResponse.json({applications:data});});
}

export async function POST(request: Request) {
  return runWebApi(request,async(database)=>{const parsed = createPartnerApplicationSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return partnerProblem(400, "invalid_partner_application", "Review the required application fields");
  const input = parsed.data;
  const { data, error } = await partnerRpc(database,"create_partner_application", {
    target_legal_name: input.legalName, target_trading_name: input.tradingName ?? "",
    target_partner_type: input.partnerType, target_country_code: input.countryCode,
    target_website: input.website ?? "", target_summary: input.summary,
    target_contact_name: input.contact.name, target_contact_email: input.contact.email,
    target_contact_phone: input.contact.phone ?? "", target_contact_title: input.contact.title ?? "",
    target_identity_scheme: input.identity.scheme, target_identity_value: input.identity.value,
    target_idempotency_key: idempotencyKey(request, input.idempotencyKey),
    target_correlation_id: correlationId(request),
  });
  if (error) return partnerDatabaseProblem(error.message);
  return NextResponse.json({ application: data }, { status: 201 });
  });
}
