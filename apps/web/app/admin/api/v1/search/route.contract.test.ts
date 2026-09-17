import { describe, expect, it } from "vitest";
import { schema } from "./schema";

describe("GET /api/v1/search contract", () => {
  it("requires a term of at least 2 characters", () => {
    expect(schema.safeParse({ term: "a" }).success).toBe(false);
    expect(schema.safeParse({ term: "ok" }).success).toBe(true);
  });

  it("only accepts brand/generic as search types", () => {
    expect(schema.safeParse({ term: "aspirin", types: ["brand"] }).success).toBe(true);
    expect(schema.safeParse({ term: "aspirin", types: ["generic"] }).success).toBe(true);
    expect(schema.safeParse({ term: "aspirin", types: ["ingredient"] }).success).toBe(false);
  });

  it("caps limit at 50, matching the trigram index route's own .limit(input.limit)", () => {
    expect(schema.safeParse({ term: "aspirin", limit: 50 }).success).toBe(true);
    expect(schema.safeParse({ term: "aspirin", limit: 51 }).success).toBe(false);
  });
});
