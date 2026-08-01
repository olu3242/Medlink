import type { MedicineSearchService } from "@medlink/search";
import type { WorkflowInstance, WorkflowStep } from "./service";

// WF-005 Medicine Search's real, executable step -- the first canonical
// workflow definition in packages/workflows backed by an actual domain
// call rather than just a name (see definitions.ts). Depends on
// @medlink/search directly rather than a further HTTP hop through a
// "versioned Experience API" (ADR 0003's diagram) -- an acknowledged
// interim shortcut for this RC1 monorepo: apps/admin's own
// GET /api/v1/search route already calls packages/search directly with no
// extra hop, so this mirrors an existing precedent rather than inventing a
// new one. A true cross-service Workflow Orchestrator would call the
// versioned API instead of the package.
//
// Reads `term` (and optionally `types`/`limit`) from the workflow
// instance's context -- set by the caller's initial context, or an earlier
// step -- and returns the result page as this step's context patch, so a
// later step (or the caller reading the completed instance) can read
// `context.searchResults`.
export function createMedicineSearchStep(searchService: MedicineSearchService): WorkflowStep {
  return {
    name: "search_catalog",
    async execute(instance: WorkflowInstance) {
      const term = typeof instance.context.term === "string" ? instance.context.term : "";
      if (term.trim() === "") {
        return { searchResults: { matches: [] }, searchSkippedReason: "empty_term" };
      }

      const types = Array.isArray(instance.context.types)
        ? (instance.context.types as readonly ("brand" | "generic")[])
        : undefined;
      const limit = typeof instance.context.limit === "number" ? instance.context.limit : undefined;

      const page = await searchService.search({
        term,
        ...(types ? { types } : {}),
        ...(limit ? { limit } : {}),
      });
      return { searchResults: page };
    },
  };
}
