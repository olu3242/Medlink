import { describe, expect, it, vi } from "vitest";
import { IncidentEvidenceService } from "./incident-evidence";

describe("incident observability evidence", () => {
  it("links alert, metrics, trace, correlation, and runbook evidence", async () => {
    const append = vi.fn(async () => "incident-1");
    const service = new IncidentEvidenceService(
      { append },
      () => new Date("2026-07-29T00:00:00Z"),
    );
    await service.record({
      key: "queue:dead-letter",
      severity: "critical",
      summary: "Dead letters require review",
      runbook: "docs/runbooks/dead-letter.md",
    }, {
      correlationId: "correlation-1",
      traceId: "trace-1",
      metricSnapshot: { dead_letter_size: 2 },
    });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: "correlation-1",
      traceId: "trace-1",
      metricSnapshot: { dead_letter_size: 2 },
    }));
  });
});
