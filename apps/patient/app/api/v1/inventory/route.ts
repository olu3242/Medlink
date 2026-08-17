import {
  AgentTaskExecutor,
  MvpAgentPolicy,
  SupabaseAgentTaskObserver,
} from "@medlink/agent-runtime";
import { routeAgent } from "@medlink/agents";
import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

interface InventorySearchResult {
  inventoryId: string;
  pharmacyLocationId: string;
  medicineName: string;
  pharmacyName: string;
  stockStatus: string;
}

const schema = z.object({
  q: z.string().trim().max(200).optional(),
  medicineId: z.string().uuid().optional(),
  marId: z.string().uuid().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).default(25),
  locationConsent: z.literal("true").optional(),
});

export const GET = (request: Request) => runExperienceApi(request, "patient.inventory.search", {
  name: "inventory.discover",
  permission: "inventory:read",
  schema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return Object.fromEntries(query.entries());
  },
  execute: async (input, context, database) => {
    const route = routeAgent({
      workflowType: "medication_access",
      workflowState: "inventory_discovery",
      requiredCapability: "inventory.discover",
      persona: context.role,
      tenantId: context.organizationId,
    });
    const application = new AccessApplication(database);
    const result = await new AgentTaskExecutor(
      new MvpAgentPolicy(),
      new SupabaseAgentTaskObserver(database),
    ).execute<Record<string, unknown>, InventorySearchResult[]>({
      id: `${context.requestId}:inventory-discovery`,
      engine: "ML-ENG-013",
      capability: route.capabilityName,
      action: "search_inventory",
      actor: context.userId,
      tenantId: context.organizationId,
      correlationId: context.correlationId,
      agentId: route.agentId,
      agentVersion: route.agentVersion,
      persona: context.role,
      requiresHumanApproval: route.requiresHumanApproval,
      context: {
        tenantId: context.organizationId,
        marId: input.marId,
        workflowId: input.marId,
      },
      input: {
        queryLength: input.q?.length ?? 0,
        locationConsent: input.locationConsent === "true",
      },
      execute: () => input.medicineId
        && input.latitude !== undefined
        && input.longitude !== undefined
        ? application.eligiblePharmacies({
            organizationId: context.organizationId,
            medicineId: input.medicineId,
            latitude: input.latitude,
            longitude: input.longitude,
            radiusKm: input.radiusKm ?? 25,
            locationConsent: input.locationConsent === "true",
          })
        : application.inventory(context.organizationId, input.q),
    });
    if (result.status !== "completed") throw new Error("Unexpected human gate");
    return result.output;
  },
});
