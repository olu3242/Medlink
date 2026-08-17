import {
  AgentTaskExecutor,
  MvpAgentPolicy,
  SupabaseAgentTaskObserver,
} from "@medlink/agent-runtime";
import { routeAgent } from "@medlink/agents";
import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
} from "@medlink/medicine";
import { z } from "zod";
import { prescriptionReviewAgentContext } from "../../../../../lib/agent-evidence-context";
import { runApi } from "../../../../../lib/api-server";

const schema = z.object({
  query: z.string().trim().min(2).max(100),
  reviewId: z.string().uuid().optional(),
});

export const GET = (request: Request) => runApi(request, {
  name: "clinical.medicines.search",
  permission: "medicine:read",
  schema,
  input: async (value) => ({
    query: new URL(value.url).searchParams.get("q"),
    reviewId: new URL(value.url).searchParams.get("reviewId") ?? undefined,
  }),
  execute: async (input, context, database) => {
    const route = routeAgent({
      workflowType: "medication_access",
      workflowState: "medicine_resolution",
      requiredCapability: "medicine.resolve",
      persona: context.role,
      tenantId: context.organizationId,
    });
    let prescriptionId: string | undefined;
    let workflowId: string | undefined;
    if (input.reviewId) {
      const evidenceContext = await prescriptionReviewAgentContext(
        database,
        context.organizationId,
        input.reviewId,
      );
      prescriptionId = evidenceContext.prescriptionId;
      workflowId = evidenceContext.workflowId;
    }
    const result = await new AgentTaskExecutor(
      new MvpAgentPolicy(),
      new SupabaseAgentTaskObserver(database),
    ).execute({
      id: `${context.requestId}:medicine-resolution`,
      engine: "ML-ENG-013",
      capability: route.capabilityName,
      action: "search_medicine",
      actor: context.userId,
      tenantId: context.organizationId,
      correlationId: context.correlationId,
      agentId: route.agentId,
      agentVersion: route.agentVersion,
      persona: context.role,
      requiresHumanApproval: route.requiresHumanApproval,
      context: { tenantId: context.organizationId, prescriptionId, workflowId },
      input: { queryLength: input.query.length },
      execute: () => new CanonicalMedicineCatalog(
        new SupabaseCanonicalMedicineRepository(database),
      ).search({ query: input.query, limit: 20, offset: 0 }),
    });
    if (result.status !== "completed") throw new Error("Unexpected human gate");
    return result.output;
  },
  success: ({ matches }) => Response.json({
    data: matches.map(({ medicine, relevance, matchedOn }) => ({
      ...medicine,
      relevance,
      matchedOn,
    })),
  }),
});
