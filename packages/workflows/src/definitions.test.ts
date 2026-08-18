import { describe, expect, it, vi } from "vitest";
import { ClinicalValidationService } from "@medlink/clinical";
import { PrescriptionParser } from "@medlink/prescription";
import { canonicalWorkflows } from "./service";
import { workflowDefinitions } from "./definitions";
import { createMedicineSearchStep } from "./medicine-search";
import { createClinicalValidationStep, createPharmacistReviewStep } from "./clinical-review";
import { createMarCreationStep } from "./mar-creation";
import { createReservationStep } from "./reservation";
import { createPrescriptionParsingStep } from "./prescription-parsing";
import { createInventoryDiscoveryStep } from "./inventory-discovery";
import { createPrescriptionUploadStep } from "./prescription-upload";

describe("workflowDefinitions", () => {
  it("defines a structural step sequence for every canonical workflow, matching its canonical name", () => {
    for (const [id, name] of canonicalWorkflows) {
      const definition = workflowDefinitions[id];
      expect(definition, `missing definition for ${id}`).toBeDefined();
      expect(definition.name).toBe(name);
      expect(definition.steps.length).toBeGreaterThan(0);
    }
  });

  it("gives every workflow a unique set of step names", () => {
    for (const definition of Object.values(workflowDefinitions)) {
      expect(new Set(definition.steps).size).toBe(definition.steps.length);
    }
  });

  // A step's real .name must actually appear in its canonical workflow's
  // structural step list, or the two silently drift -- e.g. a rename in
  // the real implementation that nobody remembers to mirror in
  // definitions.ts. Each factory is constructed with a throwaway
  // dependency (never invoked; only .name is read) rather than
  // hand-copying the expected string, so a real rename fails this test.
  it("keeps every real executable step's name in sync with its canonical workflow's structural definition", () => {
    const prescriptionParser = new PrescriptionParser(
      { findById: vi.fn(), saveExtraction: vi.fn() },
      { extract: vi.fn() },
      { recordExtraction: vi.fn() },
    );
    const realSteps: Record<string, readonly { readonly name: string }[]> = {
      "WF-003": [createPrescriptionUploadStep({ upload: vi.fn() })],
      "WF-004": [createPrescriptionParsingStep(prescriptionParser)],
      "WF-005": [createMedicineSearchStep({ search: vi.fn() })],
      "WF-006": [createMarCreationStep({ createMar: vi.fn() })],
      "WF-007": [
        createClinicalValidationStep(new ClinicalValidationService([])),
        createPharmacistReviewStep({ decide: vi.fn() }),
      ],
      "WF-008": [createInventoryDiscoveryStep({ findAvailable: vi.fn() })],
      "WF-009": [createReservationStep({ createReservation: vi.fn() })],
    };

    for (const [id, steps] of Object.entries(realSteps)) {
      const definition = workflowDefinitions[id as keyof typeof workflowDefinitions];
      for (const step of steps) {
        expect(
          definition.steps,
          `${id}'s real step "${step.name}" is missing from its structural definition`,
        ).toContain(step.name);
      }
    }
  });
});
