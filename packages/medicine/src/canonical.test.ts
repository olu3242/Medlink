import { describe, expect, it, vi } from "vitest";
import {
  CanonicalMedicineCatalog,
  CanonicalMedicineNotFoundError,
  catalogMedicineSummarySchema,
  normalizeStrengthDisplay,
  saveCatalogMedicineSchema,
  type CanonicalMedicineRepository,
} from "./canonical";

function repository(): CanonicalMedicineRepository {
  return {
    listIngredients: vi.fn().mockResolvedValue([]),
    createIngredient: vi.fn(),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    find: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue({ matches: [] }),
    alternatives: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    merge: vi.fn(),
    createAlternative: vi.fn(),
  };
}

describe("canonical medicine catalogue", () => {
  it.each([
    ["500 MG", "500 mg"],
    ["250 mg / 5 ml", "250 mg/5 mL"],
    ["100 iu", "100 IU"],
    ["0.50 %", "0.5%"],
    ["125 μg", "125 mcg"],
  ])("normalizes %s to %s", (source, expected) => {
    expect(normalizeStrengthDisplay(source)).toBe(expected);
  });

  it("requires at least one canonical active ingredient on writes", () => {
    expect(() => saveCatalogMedicineSchema.parse({
      brandName: "Panadol",
      genericName: "Paracetamol",
      dosageForm: "tablet",
      route: "oral",
      strength: "500 mg",
      ingredients: [],
    })).toThrow();
  });

  it("keeps registration dates chronological", () => {
    expect(() => saveCatalogMedicineSchema.parse({
      brandName: "Panadol",
      genericName: "Paracetamol",
      dosageForm: "tablet",
      route: "oral",
      strength: "500 mg",
      ingredients: [{
        ingredientId: "11111111-1111-4111-8111-111111111111",
        amount: 500,
        unit: "mg",
      }],
      registrations: [{
        countryCode: "NG",
        authorityCode: "NAFDAC",
        registrationNumber: "A1-2345",
        validFrom: "2027-01-01",
        validUntil: "2026-01-01",
      }],
    })).toThrow("Registration expiry must not precede");
  });

  it("returns a typed not-found result", async () => {
    const service = new CanonicalMedicineCatalog(repository());
    await expect(service.find(
      "11111111-1111-4111-8111-111111111111",
    )).rejects.toBeInstanceOf(CanonicalMedicineNotFoundError);
  });

  it("projects a full canonical medicine into its search summary", () => {
    const summary = catalogMedicineSummarySchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      brandName: "Panadol",
      genericName: "Paracetamol",
      therapeuticClassId: null,
      therapeuticClass: null,
      dosageForm: "tablet",
      route: "oral",
      strength: "500 mg",
      normalizedStrength: "500 mg",
      packSize: null,
      manufacturer: null,
      controlled: false,
      status: "active",
      version: 1,
      aliases: [],
      ingredients: [],
      registrations: [],
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    expect(summary.brandName).toBe("Panadol");
    expect(summary).not.toHaveProperty("ingredients");
  });

  it("keeps merge and alternative creation inside the repository boundary", async () => {
    const value = repository();
    const service = new CanonicalMedicineCatalog(value);
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const sourceMedicineId = "22222222-2222-4222-8222-222222222222";
    const targetMedicineId = "33333333-3333-4333-8333-333333333333";
    await service.merge({
      organizationId,
      actorId: organizationId,
      sourceMedicineId,
      targetMedicineId,
      expectedSourceVersion: 1,
      expectedTargetVersion: 2,
      rationale: "Verified duplicate canonical medicine",
      idempotencyKey: "merge-1",
      correlationId: "correlation-1",
      requestId: "request-1",
    });
    await service.createAlternative({
      organizationId,
      actorId: organizationId,
      sourceMedicineId,
      alternativeMedicineId: targetMedicineId,
      kind: "pharmaceutical",
      rationale: "Equivalent formulation",
      idempotencyKey: "alternative-1",
      correlationId: "correlation-1",
      requestId: "request-2",
    });
    expect(value.merge).toHaveBeenCalledOnce();
    expect(value.createAlternative).toHaveBeenCalledOnce();
  });
});
