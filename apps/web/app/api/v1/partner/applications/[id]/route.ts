import { updatePartnerApplicationSchema } from "@medlink/partner";
import { NextResponse } from "next/server";
import { applicationIdSchema, correlationId, getPartnerApplication, idempotencyKey, jsonBody, partnerDatabaseProblem, partnerProblem, partnerRpc, runWebApi } from "../../../../../../lib/partner";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return runWebApi(request,async(database)=>{const id = applicationIdSchema.safeParse((await context.params).id);
  if (!id.success) return partnerProblem(400, "invalid_application_id", "A valid application ID is required");
  const { data, error } = await getPartnerApplication(database,id.data);
  if (error) return partnerDatabaseProblem(error.message);
  return NextResponse.json({ application: data });
  });
}

export async function PATCH(request: Request, context: Context) {
  return runWebApi(request,async(database)=>{const id = applicationIdSchema.safeParse((await context.params).id);
  const parsed = updatePartnerApplicationSchema.safeParse(await jsonBody(request));
  if (!id.success || !parsed.success) return partnerProblem(400, "invalid_partner_update", "Review the application update");
  const { data, error } = await partnerRpc(database,"update_partner_application", {
    target_application_id: id.data, target_expected_version: parsed.data.expectedVersion,
    target_trading_name: parsed.data.tradingName ?? "", target_website: parsed.data.website ?? "",
    target_summary: parsed.data.summary ?? "",
    target_idempotency_key: idempotencyKey(request), target_correlation_id: correlationId(request),
  });
  if (error) return partnerDatabaseProblem(error.message);
  return NextResponse.json({ application: data });
  });
}
