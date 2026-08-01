import { AIGateway, FakeModelProvider, PromptRegistry } from "@medlink/ai";
import type { BrandMedicine, GenericMedicine, MedicineCatalogReader } from "@medlink/medicine";
import type { MedicineSearchService, SearchMatch, SearchPage } from "@medlink/search";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { AgentCapabilityDeniedError } from "./agent-runtime";
import { AtlasAgent, atlasPromptDefinitions } from "./atlas";

const pharmacistContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "pharmacist",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

const tenantAdminContext: RuntimeContext = { ...pharmacistContext, role: "tenant_admin" };

const now = new Date("2026-01-01T00:00:00Z");

const amoxicillinGeneric: GenericMedicine = {
  id: "generic-amoxicillin",
  canonicalName: "Amoxicillin",
  normalizedName: "amoxicillin",
  therapeuticClass: "antibiotic",
  controlled: false,
  status: "active",
  createdAt: now,
  updatedAt: now,
};

const amoxilBrand: BrandMedicine = {
  id: "brand-amoxil",
  brandName: "Amoxil",
  normalizedName: "amoxil",
  manufacturer: "GSK",
  ingredients: [{ genericId: amoxicillinGeneric.id, amount: 500, unit: "mg" }],
  dosageForm: "capsule",
  route: "oral",
  status: "active",
  createdAt: now,
  updatedAt: now,
};

const moxatagBrand: BrandMedicine = {
  id: "brand-moxatag",
  brandName: "Moxatag",
  normalizedName: "moxatag",
  manufacturer: "MiddleBrook",
  ingredients: [{ genericId: amoxicillinGeneric.id, amount: 500, unit: "mg" }],
  dosageForm: "tablet",
  route: "oral",
  status: "active",
  createdAt: now,
  updatedAt: now,
};

class FakeCatalogReader implements MedicineCatalogReader {
  constructor(
    private readonly generics: readonly GenericMedicine[] = [],
    private readonly brands: readonly BrandMedicine[] = [],
  ) {}

  async findBrandById(id: string): Promise<BrandMedicine | null> {
    return this.brands.find((brand) => brand.id === id) ?? null;
  }

  async findGenericById(id: string): Promise<GenericMedicine | null> {
    return this.generics.find((generic) => generic.id === id) ?? null;
  }

  async findBrandsByIngredientIds(genericIds: readonly string[]): Promise<readonly BrandMedicine[]> {
    return this.brands.filter((brand) => brand.ingredients.some((ingredient) => genericIds.includes(ingredient.genericId)));
  }
}

class FakeSearchService implements MedicineSearchService {
  constructor(private readonly matches: readonly SearchMatch[] = []) {}

  async search(): Promise<SearchPage> {
    return { matches: this.matches };
  }
}

function buildAgent(searchMatches: readonly SearchMatch[], respond?: (prompt: string) => string) {
  const catalog = new FakeCatalogReader([amoxicillinGeneric], [amoxilBrand, moxatagBrand]);
  const search = new FakeSearchService(searchMatches);
  const registry = new PromptRegistry(atlasPromptDefinitions);
  const provider = new FakeModelProvider("fake-atlas-provider", (request) => ({
    text: respond ? respond(request.prompt) : `identified: ${request.prompt}`,
    modelId: "fake-atlas-provider",
    inputTokens: 1,
    outputTokens: 1,
  }));
  const routes = new Map(atlasPromptDefinitions.map((prompt) => [prompt.id, [provider]]));
  const gateway = new AIGateway(registry, routes);
  return new AtlasAgent(gateway, catalog, search);
}

describe("AtlasAgent.respond -- normalize_medicine_name", () => {
  it("returns a catalog exact match with confidence 1 and no AI Gateway call", async () => {
    let modelCalled = false;
    const agent = buildAgent(
      [{ entity: { type: "brand", value: amoxilBrand }, score: 1, matchedOn: "name" }],
      () => {
        modelCalled = true;
        return "unused";
      },
    );
    const response = await agent.respond(pharmacistContext, { capability: "normalize_medicine_name", medicineName: "Amoxil" });
    expect(response.capability).toBe("normalize_medicine_name");
    if (response.capability !== "normalize_medicine_name") throw new Error("unreachable");
    expect(response.result.confidence).toBe(1);
    expect(response.result.brand).toBe("Amoxil");
    expect(response.result.generic).toBe("Amoxicillin");
    expect(response.result.strength).toBe("500mg");
    expect(response.result.dosageForm).toBe("capsule");
    expect(response.result.possibleAlternatives).toEqual(["Moxatag"]);
    expect(response.result.requiresHumanReview).toBe(false);
    expect(response.result.evidence[0]?.source).toBe("catalog_exact_match");
    expect(modelCalled).toBe(false);
  });

  it("returns a fuzzy match with requiresHumanReview when confidence is below the high-confidence threshold", async () => {
    const agent = buildAgent([{ entity: { type: "brand", value: amoxilBrand }, score: 0.5, matchedOn: "name" }]);
    const response = await agent.respond(pharmacistContext, { capability: "normalize_medicine_name", medicineName: "Amoxiciln" });
    if (response.capability !== "normalize_medicine_name") throw new Error("unreachable");
    expect(response.result.confidence).toBe(0.5);
    expect(response.result.evidence[0]?.source).toBe("catalog_fuzzy_match");
    expect(response.result.requiresHumanReview).toBe(true);
  });

  it("does not require human review for a fuzzy match at or above the high-confidence threshold", async () => {
    const agent = buildAgent([{ entity: { type: "brand", value: amoxilBrand }, score: 0.85, matchedOn: "name" }]);
    const response = await agent.respond(pharmacistContext, { capability: "normalize_medicine_name", medicineName: "Amoxil Caps" });
    if (response.capability !== "normalize_medicine_name") throw new Error("unreachable");
    expect(response.result.requiresHumanReview).toBe(false);
  });

  it("resolves a generic-entity match with its sibling brands as alternatives", async () => {
    const agent = buildAgent([{ entity: { type: "generic", value: amoxicillinGeneric }, score: 1, matchedOn: "name" }]);
    const response = await agent.respond(pharmacistContext, { capability: "normalize_medicine_name", medicineName: "Amoxicillin" });
    if (response.capability !== "normalize_medicine_name") throw new Error("unreachable");
    expect(response.result.generic).toBe("Amoxicillin");
    expect(response.result.brand).toBeUndefined();
    expect([...response.result.possibleAlternatives].sort()).toEqual(["Amoxil", "Moxatag"]);
  });

  it("falls back to the AI Gateway when no catalog match clears the fuzzy threshold", async () => {
    let modelCalled = false;
    const agent = buildAgent(
      [{ entity: { type: "brand", value: amoxilBrand }, score: 0.1, matchedOn: "name" }],
      (prompt) => {
        modelCalled = true;
        return `Likely refers to: ${prompt}`;
      },
    );
    const response = await agent.respond(pharmacistContext, { capability: "normalize_medicine_name", medicineName: "Panadl" });
    if (response.capability !== "normalize_medicine_name") throw new Error("unreachable");
    expect(modelCalled).toBe(true);
    expect(response.result.confidence).toBe(0.3);
    expect(response.result.requiresHumanReview).toBe(true);
    expect(response.result.evidence[0]?.source).toBe("llm_assistance");
  });

  it("falls back to the AI Gateway when the catalog returns no matches at all", async () => {
    const agent = buildAgent([]);
    const response = await agent.respond(pharmacistContext, { capability: "normalize_medicine_name", medicineName: "Unknownolol" });
    if (response.capability !== "normalize_medicine_name") throw new Error("unreachable");
    expect(response.result.evidence[0]?.source).toBe("llm_assistance");
  });

  it("denies a role not permitted by the governed catalog before contacting the catalog or the model", async () => {
    const agent = buildAgent([{ entity: { type: "brand", value: amoxilBrand }, score: 1, matchedOn: "name" }]);
    const providerContext: RuntimeContext = { ...pharmacistContext, role: "provider" };
    await expect(
      agent.respond(providerContext, { capability: "normalize_medicine_name", medicineName: "Amoxil" }),
    ).rejects.toThrow(AgentCapabilityDeniedError);
  });
});

describe("AtlasAgent.respond -- search_medicines", () => {
  it("returns ranked structured matches without contacting the AI Gateway", async () => {
    let modelCalled = false;
    const agent = buildAgent(
      [
        { entity: { type: "brand", value: amoxilBrand }, score: 0.9, matchedOn: "name" },
        { entity: { type: "generic", value: amoxicillinGeneric }, score: 0.7, matchedOn: "name" },
      ],
      () => {
        modelCalled = true;
        return "unused";
      },
    );
    const response = await agent.respond(pharmacistContext, { capability: "search_medicines", term: "Amox" });
    if (response.capability !== "search_medicines") throw new Error("unreachable");
    expect(response.result.matches).toEqual([
      { entityType: "brand", name: "Amoxil", medicineId: "brand-amoxil", confidence: 0.9 },
      { entityType: "generic", name: "Amoxicillin", medicineId: "generic-amoxicillin", confidence: 0.7 },
    ]);
    expect(modelCalled).toBe(false);
  });

  it("denies a role not permitted for search", async () => {
    const agent = buildAgent([]);
    const providerContext: RuntimeContext = { ...pharmacistContext, role: "provider" };
    await expect(agent.respond(providerContext, { capability: "search_medicines", term: "x" })).rejects.toThrow(
      AgentCapabilityDeniedError,
    );
  });
});

describe("AtlasAgent.respond -- detect_duplicate_medicines", () => {
  it("flags an existing exact-normalized-name match as a duplicate candidate", async () => {
    const agent = buildAgent([{ entity: { type: "brand", value: amoxilBrand }, score: 1, matchedOn: "name" }]);
    const response = await agent.respond(tenantAdminContext, { capability: "detect_duplicate_medicines", candidateName: "Amoxil" });
    if (response.capability !== "detect_duplicate_medicines") throw new Error("unreachable");
    expect(response.result.duplicatesFound).toBe(true);
    expect(response.result.candidates).toEqual([
      { matchedEntityType: "brand", matchedName: "Amoxil", medicineId: "brand-amoxil", similarity: 1, matchType: "exact_normalized_name" },
    ]);
    expect(response.result.warnings).toHaveLength(1);
  });

  it("flags a near-duplicate spelling variation above the similarity threshold", async () => {
    const agent = buildAgent([{ entity: { type: "brand", value: amoxilBrand }, score: 0.75, matchedOn: "name" }]);
    const response = await agent.respond(tenantAdminContext, {
      capability: "detect_duplicate_medicines",
      candidateName: "Amoxxil",
    });
    if (response.capability !== "detect_duplicate_medicines") throw new Error("unreachable");
    expect(response.result.candidates[0]?.matchType).toBe("fuzzy_name_match");
  });

  it("reports no duplicates when every match is below the similarity threshold", async () => {
    const agent = buildAgent([{ entity: { type: "brand", value: amoxilBrand }, score: 0.2, matchedOn: "name" }]);
    const response = await agent.respond(tenantAdminContext, {
      capability: "detect_duplicate_medicines",
      candidateName: "SomethingElse",
    });
    if (response.capability !== "detect_duplicate_medicines") throw new Error("unreachable");
    expect(response.result.duplicatesFound).toBe(false);
    expect(response.result.candidates).toEqual([]);
    expect(response.result.warnings).toEqual([]);
  });

  it("denies a role not permitted to check for duplicates (a patient cannot manage the catalog)", async () => {
    const agent = buildAgent([]);
    const patientContext: RuntimeContext = { ...pharmacistContext, role: "patient" };
    await expect(
      agent.respond(patientContext, { capability: "detect_duplicate_medicines", candidateName: "x" }),
    ).rejects.toThrow(AgentCapabilityDeniedError);
  });

  it("allows a tenant_admin to check for duplicates", async () => {
    const agent = buildAgent([]);
    const adminContext: RuntimeContext = { ...pharmacistContext, role: "tenant_admin" };
    const response = await agent.respond(adminContext, { capability: "detect_duplicate_medicines", candidateName: "x" });
    expect(response.capability).toBe("detect_duplicate_medicines");
  });
});

describe("atlasPromptDefinitions", () => {
  it("registers cleanly (contract validated at registration time)", () => {
    expect(() => new PromptRegistry(atlasPromptDefinitions)).not.toThrow();
  });
});
