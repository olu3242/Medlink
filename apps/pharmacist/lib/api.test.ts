import { afterEach, describe, expect, it, vi } from "vitest";
import { decide } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decide", () => {
  it("PATCHes the namespaced pharmacist review contract, not a nonexistent /decision path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await decide("review-1", { decision: "approved", recommendation: "Approve as prescribed." });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/pharmacist/api/v1/review/review-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      decision: "approved",
      recommendation: "Approve as prescribed.",
    });
  });

  it("only ever sends a decision value the clinical_review_decision DB enum actually has", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (const decision of ["approved", "rejected", "needs_information"] as const) {
      await decide("review-1", { decision, recommendation: "x" });
    }

    const sentDecisions = (fetchMock.mock.calls as [URL, RequestInit][]).map(
      ([, init]) => (JSON.parse(init.body as string) as { decision: string }).decision,
    );
    expect(sentDecisions).toEqual(["approved", "rejected", "needs_information"]);
    expect(sentDecisions).not.toContain("approve_equivalent");
  });

  it("throws when the request fails, so the form can show its error state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    await expect(decide("review-1", { decision: "rejected", recommendation: "x" }))
      .rejects.toThrow();
  });
});
