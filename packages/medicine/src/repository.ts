import type {
  BrandMedicine,
  GenericMedicine,
  MedicineStatus,
} from "./models";
import type {
  CreateBrandMedicine,
  CreateGenericMedicine,
} from "./validation";

export interface MedicineListOptions {
  readonly status?: MedicineStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export interface MedicinePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface MedicineRepository {
  findBrandById(id: string): Promise<BrandMedicine | null>;
  findGenericById(id: string): Promise<GenericMedicine | null>;
  listBrands(options: MedicineListOptions): Promise<MedicinePage<BrandMedicine>>;
  listGenerics(options: MedicineListOptions): Promise<MedicinePage<GenericMedicine>>;
  createBrand(input: CreateBrandMedicine): Promise<BrandMedicine>;
  createGeneric(input: CreateGenericMedicine): Promise<GenericMedicine>;
}

export interface MedicineCatalogReader {
  findBrandById(id: string): Promise<BrandMedicine | null>;
  findGenericById(id: string): Promise<GenericMedicine | null>;
  findBrandsByIngredientIds(
    genericIds: readonly string[],
  ): Promise<readonly BrandMedicine[]>;
}
