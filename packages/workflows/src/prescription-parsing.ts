import type { PrescriptionParser } from "@medlink/prescription";
import type { WorkflowInstance, WorkflowStep } from "./service";

interface PrescriptionParseInput {
  readonly tenantId: string;
  readonly prescriptionId: string;
}

function isPrescriptionParseInput(value: unknown): value is PrescriptionParseInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.tenantId === "string" && typeof candidate.prescriptionId === "string";
}

// WF-004 Prescription Parsing's real, executable "run_extraction" step --
// unlike WF-006/WF-007/WF-009 (which needed a new packages/workflows-level
// port since MAR/reservation/review creation have no portable domain
// package), this wraps packages/prescription's PrescriptionParser
// directly, the same way medicine-search.ts wraps MedicineSearchService:
// it's already a complete domain service whose own ports (repository, OCR
// reader, audit) the caller supplies -- apps/admin/lib/
// prescription-extraction.ts's Supabase-backed implementations already
// exist from Wave 2's wiring pass.
//
// A parser-level failure (e.g. PrescriptionExtractionError for a
// malformed OCR result) is not caught here -- it propagates, since a
// failed extraction is a real failure the caller must see, not a
// skippable input-shape gap the way a missing context value is.
export function createPrescriptionParsingStep(parser: PrescriptionParser): WorkflowStep {
  return {
    name: "run_extraction",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.prescriptionParseInput;
      if (!isPrescriptionParseInput(input)) {
        return { prescriptionParsingSkippedReason: "missing_or_invalid_input" };
      }
      return { prescriptionExtraction: await parser.parse(input) };
    },
  };
}
