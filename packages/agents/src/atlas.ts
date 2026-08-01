import type { AIGateway, PromptDefinition } from "@medlink/ai";
import { normalizeMedicineName, type BrandMedicine, type MedicineCatalogReader } from "@medlink/medicine";
import type { MedicineSearchService, SearchMatch } from "@medlink/search";
import type { RuntimeContext } from "@medlink/runtime";
import { authorizeAgentCapability } from "./policy";
import { AgentCapabilityDeniedError } from "./agent-runtime";

// AG-03 -- Atlas, the Medicine Intelligence Agent. Extends the AGSDK-14
// skeleton (same class name, same registry entry) rather than introducing
// a second Atlas -- the skeleton's own certification doc named exactly
// this work (normalization, search, duplicate detection) as its deferred
// future scope.
//
// "Prefer structured catalog lookups over LLM reasoning whenever
// possible" is not a suggestion here, it is the control flow: every
// capability below tries the real medicine catalog and the real
// trigram-backed search service (packages/search, already built,
// production-quality relevance scoring) FIRST. The AI Gateway is only
// ever contacted by normalize_medicine_name, and only on its last
// fallback branch, when the catalog and fuzzy search both come back
// empty or low-confidence. search_medicines and detect_duplicate_medicines
// never call the model at all -- there is nothing for an LLM to add to a
// structured-data lookup or a similarity comparison, and skipping it
// removes an entire class of hallucination risk for those two
// capabilities by construction, not by guardrail.
//
// Atlas never recommends a substitution, never approves an alternative,
// and never makes a clinical judgment -- "possibleAlternatives" below is
// a plain list of other catalog entries sharing the same generic
// ingredient, nothing more. Clinical equivalence reasoning already exists
// in this codebase (packages/medicine's CatalogEquivalencyService) and is
// deliberately not called from here; alternative-brand suggestion and
// clinical substitution are different concerns, and conflating them would
// let a "search suggestion" quietly become a "recommendation," which
// Atlas's own mission statement forbids.

export type AtlasCapability = "normalize_medicine_name" | "search_medicines" | "detect_duplicate_medicines";

export type AtlasRequest =
  | { readonly capability: "normalize_medicine_name"; readonly medicineName: string }
  | { readonly capability: "search_medicines"; readonly term: string; readonly limit?: number }
  | { readonly capability: "detect_duplicate_medicines"; readonly candidateName: string };

export type AtlasEvidenceSource = "catalog_exact_match" | "catalog_fuzzy_match" | "llm_assistance";

export interface AtlasEvidence {
  readonly source: AtlasEvidenceSource;
  readonly description: string;
  readonly medicineId?: string;
  readonly score?: number;
}

export interface AtlasNormalizationResult {
  readonly normalizedName: string;
  readonly brand?: string;
  readonly generic?: string;
  readonly strength?: string;
  readonly dosageForm?: string;
  readonly confidence: number;
  readonly possibleAlternatives: readonly string[];
  readonly warnings: readonly string[];
  readonly evidence: readonly AtlasEvidence[];
  readonly requiresHumanReview: boolean;
}

export interface AtlasSearchMatch {
  readonly entityType: "brand" | "generic";
  readonly name: string;
  readonly medicineId: string;
  readonly confidence: number;
}

export interface AtlasSearchResult {
  readonly term: string;
  readonly matches: readonly AtlasSearchMatch[];
}

export type AtlasDuplicateMatchType = "exact_normalized_name" | "fuzzy_name_match";

export interface AtlasDuplicateCandidate {
  readonly matchedEntityType: "brand" | "generic";
  readonly matchedName: string;
  readonly medicineId: string;
  readonly similarity: number;
  readonly matchType: AtlasDuplicateMatchType;
}

export interface AtlasDuplicateDetectionResult {
  readonly candidateName: string;
  readonly duplicatesFound: boolean;
  readonly candidates: readonly AtlasDuplicateCandidate[];
  readonly warnings: readonly string[];
}

export type AtlasResponse =
  | { readonly capability: "normalize_medicine_name"; readonly result: AtlasNormalizationResult }
  | { readonly capability: "search_medicines"; readonly result: AtlasSearchResult }
  | { readonly capability: "detect_duplicate_medicines"; readonly result: AtlasDuplicateDetectionResult };

const ATLAS_NORMALIZE_MEDICINE_NAME_PROMPT_ID = "atlas_normalize_medicine_name";

export const atlasPromptDefinitions: readonly PromptDefinition[] = [
  {
    id: ATLAS_NORMALIZE_MEDICINE_NAME_PROMPT_ID,
    version: "0.2.0",
    owner: "medicine-intelligence-team",
    purpose: "Last-resort, LLM-assisted medicine name identification, used only when the catalog and fuzzy search both find no adequate match. Never used for search or duplicate detection.",
    allowedRoles: ["patient", "pharmacist", "pharmacy_staff"],
    requiredInputs: ["term"],
    template:
      "You are Atlas, MedLink's medicine intelligence assistant. A search term "
      + "was not found in the medicine catalog through exact or fuzzy matching. "
      + "Given the term, identify the single most likely standardized brand or "
      + "generic medicine name it refers to, if you can do so with reasonable "
      + "confidence. You are not making a clinical recommendation -- do not "
      + "suggest a dosage, a substitution, or any clinical guidance, only "
      + "identify what medicine name was likely meant. If you cannot identify a "
      + "specific medicine with reasonable confidence, say so plainly rather "
      + "than guessing. Search term: {{term}}",
  },
];

// Both thresholds are heuristics against packages/search's real pg_trgm
// similarity score (0-1, from the search_medicines RPC), not certified
// clinical thresholds -- documented as such, same discipline
// alice-guardrail.ts already applies to its own heuristics. Tunable
// without a code change to the capabilities that use them, since both are
// named constants in one place.
const FUZZY_MATCH_ACCEPT_THRESHOLD = 0.4;
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const NEAR_DUPLICATE_THRESHOLD = 0.6;
const LLM_FALLBACK_CONFIDENCE = 0.3;
const MAX_ALTERNATIVES = 5;

function entityDisplayName(entity: SearchMatch["entity"]): string {
  return entity.type === "brand" ? entity.value.brandName : entity.value.canonicalName;
}

function entityId(entity: SearchMatch["entity"]): string {
  return entity.value.id;
}

function entityNormalizedName(entity: SearchMatch["entity"]): string {
  return entity.value.normalizedName;
}

export class AtlasAgent {
  constructor(
    private readonly gateway: AIGateway,
    private readonly catalog: MedicineCatalogReader,
    private readonly search: MedicineSearchService,
  ) {}

  async respond(context: RuntimeContext, request: AtlasRequest): Promise<AtlasResponse> {
    const authorization = authorizeAgentCapability(context, "atlas", request.capability);
    if (!authorization.allowed) {
      throw new AgentCapabilityDeniedError("atlas", request.capability, authorization.reason!);
    }

    if (request.capability === "normalize_medicine_name") {
      return { capability: request.capability, result: await this.normalizeMedicineName(context, request.medicineName) };
    }
    if (request.capability === "search_medicines") {
      return { capability: request.capability, result: await this.searchMedicines(request.term, request.limit) };
    }
    return { capability: request.capability, result: await this.detectDuplicateMedicines(request.candidateName) };
  }

  private async normalizeMedicineName(context: RuntimeContext, medicineName: string): Promise<AtlasNormalizationResult> {
    const normalizedInput = normalizeMedicineName(medicineName);
    const page = await this.search.search({ term: medicineName, limit: 5 });
    const top = page.matches[0];

    if (top && entityNormalizedName(top.entity) === normalizedInput) {
      return this.describeMatch(normalizedInput, top, 1, "catalog_exact_match", false);
    }
    if (top && top.score >= FUZZY_MATCH_ACCEPT_THRESHOLD) {
      return this.describeMatch(
        normalizedInput,
        top,
        top.score,
        "catalog_fuzzy_match",
        top.score < HIGH_CONFIDENCE_THRESHOLD,
      );
    }

    // Last resort: no adequate catalog match. A real AI Gateway call,
    // authorized and prompt-registered like every other model call in
    // this codebase -- but reached only here, never for search or
    // duplicate detection, per this module's own stated control flow.
    const invocation = await this.gateway.invoke(context, {
      promptId: ATLAS_NORMALIZE_MEDICINE_NAME_PROMPT_ID,
      inputs: { term: medicineName },
    });
    return {
      normalizedName: normalizedInput,
      confidence: LLM_FALLBACK_CONFIDENCE,
      possibleAlternatives: [],
      warnings: ["No catalog match found for this term; this result is LLM-assisted and requires human review."],
      evidence: [{ source: "llm_assistance", description: invocation.result.text }],
      requiresHumanReview: true,
    };
  }

  private async describeMatch(
    normalizedName: string,
    match: SearchMatch,
    confidence: number,
    source: AtlasEvidenceSource,
    requiresHumanReview: boolean,
  ): Promise<AtlasNormalizationResult> {
    const evidence: AtlasEvidence = {
      source,
      description: `Matched "${entityDisplayName(match.entity)}" in the medicine catalog.`,
      medicineId: entityId(match.entity),
      score: match.score,
    };

    if (match.entity.type === "generic") {
      const alternatives = await this.alternativeBrandNames([match.entity.value.id], undefined);
      return {
        normalizedName,
        generic: match.entity.value.canonicalName,
        confidence,
        possibleAlternatives: alternatives,
        warnings: [],
        evidence: [evidence],
        requiresHumanReview,
      };
    }

    const brand: BrandMedicine = match.entity.value;
    const genericIds = brand.ingredients.map((ingredient) => ingredient.genericId);
    const generic = genericIds.length > 0 ? await this.catalog.findGenericById(genericIds[0]!) : null;
    const strength = brand.ingredients.map((ingredient) => `${ingredient.amount}${ingredient.unit}`).join(" / ");
    const alternatives = await this.alternativeBrandNames(genericIds, brand.id);

    return {
      normalizedName,
      brand: brand.brandName,
      ...(generic ? { generic: generic.canonicalName } : {}),
      ...(strength.length > 0 ? { strength } : {}),
      dosageForm: brand.dosageForm,
      confidence,
      possibleAlternatives: alternatives,
      warnings: [],
      evidence: [evidence],
      requiresHumanReview,
    };
  }

  private async alternativeBrandNames(genericIds: readonly string[], excludeBrandId: string | undefined): Promise<readonly string[]> {
    if (genericIds.length === 0) return [];
    const siblings = await this.catalog.findBrandsByIngredientIds(genericIds);
    return siblings
      .filter((brand) => brand.id !== excludeBrandId)
      .slice(0, MAX_ALTERNATIVES)
      .map((brand) => brand.brandName);
  }

  private async searchMedicines(term: string, limit: number | undefined): Promise<AtlasSearchResult> {
    const page = await this.search.search({ term, limit: limit ?? 10 });
    return {
      term,
      matches: page.matches.map((match) => ({
        entityType: match.entity.type,
        name: entityDisplayName(match.entity),
        medicineId: entityId(match.entity),
        confidence: match.score,
      })),
    };
  }

  private async detectDuplicateMedicines(candidateName: string): Promise<AtlasDuplicateDetectionResult> {
    const normalizedInput = normalizeMedicineName(candidateName);
    const page = await this.search.search({ term: candidateName, limit: 10 });

    const candidates: AtlasDuplicateCandidate[] = page.matches
      .filter((match) => match.score >= NEAR_DUPLICATE_THRESHOLD)
      .map((match) => ({
        matchedEntityType: match.entity.type,
        matchedName: entityDisplayName(match.entity),
        medicineId: entityId(match.entity),
        similarity: match.score,
        matchType: entityNormalizedName(match.entity) === normalizedInput ? "exact_normalized_name" : "fuzzy_name_match",
      }));

    return {
      candidateName,
      duplicatesFound: candidates.length > 0,
      candidates,
      warnings:
        candidates.length > 0
          ? [`Found ${candidates.length} potential duplicate(s) in the catalog at or above the similarity threshold (${NEAR_DUPLICATE_THRESHOLD}).`]
          : [],
    };
  }
}
