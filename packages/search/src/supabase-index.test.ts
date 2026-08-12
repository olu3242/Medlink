import { describe, expect, it, vi } from "vitest";
import { SupabaseMedicineSearchIndex } from "./supabase-index";

describe("SupabaseMedicineSearchIndex", () => {
  it("preserves database ranking and emits a stable cursor", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { entity_id: "a", entity_type: "brand", relevance: 0.9, matched_on: "brand" },
        { entity_id: "b", entity_type: "generic", relevance: 0.8, matched_on: "generic" },
      ],
      error: null,
    });
    const index = new SupabaseMedicineSearchIndex({ rpc } as never);
    const result = await index.search({
      normalizedTerm: "amoxicillin",
      types: ["brand", "generic"],
      limit: 1,
    });
    expect(result.hits[0]?.id).toBe("a");
    expect(result.nextCursor).toBe("1");
  });
});
