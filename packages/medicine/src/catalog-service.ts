import { MedicineNotFoundError } from "./errors";
import type { MedicineListOptions, MedicineRepository } from "./repository";
import {
  createBrandMedicineSchema,
  createGenericMedicineSchema,
  type CreateBrandMedicine,
  type CreateGenericMedicine,
} from "./validation";

export class MedicineCatalogService {
  constructor(private readonly repository: MedicineRepository) {}

  listBrands(options: MedicineListOptions) {
    return this.repository.listBrands(options);
  }
  listGenerics(options: MedicineListOptions) {
    return this.repository.listGenerics(options);
  }
  async brand(id: string) {
    const value = await this.repository.findBrandById(id);
    if (!value) throw new MedicineNotFoundError("brand", id);
    return value;
  }
  async generic(id: string) {
    const value = await this.repository.findGenericById(id);
    if (!value) throw new MedicineNotFoundError("generic", id);
    return value;
  }
  createBrand(input: CreateBrandMedicine) {
    return this.repository.createBrand(createBrandMedicineSchema.parse(input));
  }
  createGeneric(input: CreateGenericMedicine) {
    return this.repository.createGeneric(createGenericMedicineSchema.parse(input));
  }
}
