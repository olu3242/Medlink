import type {
  BrandMedicine,
  GenericMedicine,
} from "@medlink/medicine";
import type {
  SearchEntityType,
  SearchIndexHit,
} from "./contracts";

export interface MedicineSearchIndex {
  search(input: {
    readonly normalizedTerm: string;
    readonly types: readonly SearchEntityType[];
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<{ readonly hits: readonly SearchIndexHit[]; readonly nextCursor?: string }>;
}

export interface SearchMedicineReader {
  findBrandsByIds(ids: readonly string[]): Promise<readonly BrandMedicine[]>;
  findGenericsByIds(ids: readonly string[]): Promise<readonly GenericMedicine[]>;
}
