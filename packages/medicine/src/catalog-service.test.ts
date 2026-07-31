import { describe, expect, it, vi } from "vitest";
import { MedicineCatalogService } from "./catalog-service";
import type { MedicineRepository } from "./repository";

describe("MedicineCatalogService", () => {
  it("fails with a typed not-found error", async () => {
    const repository = {
      findBrandById: vi.fn().mockResolvedValue(null),
      findGenericById: vi.fn().mockResolvedValue(null),
      listBrands: vi.fn(),
      listGenerics: vi.fn(),
      createBrand: vi.fn(),
      createGeneric: vi.fn(),
    } satisfies MedicineRepository;
    await expect(new MedicineCatalogService(repository).brand(
      "00000000-0000-4000-8000-000000000001",
    )).rejects.toMatchObject({ code: "medicine_not_found", status: 404 });
  });
});
