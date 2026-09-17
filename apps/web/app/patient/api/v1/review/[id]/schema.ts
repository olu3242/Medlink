import { z } from "zod";

// decision must stay exactly the clinical_review_decision DB enum
// (migration 202607270003: pending/approved/rejected/needs_information)
// minus "pending". This drifted once already ("changes_requested", a value
// the enum has never had - see docs/audit/RC1_SPRINT_REPORT.md Sprint 3);
// see route.contract.test.ts for the regression test.
export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_information"]),
  recommendation: z.string().min(3).max(4000),
});
