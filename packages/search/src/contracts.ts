import type {
  BrandMedicine,
  GenericMedicine,
} from "../../medicine/src/index";

export type SearchEntityType = "brand" | "generic";

export interface MedicineSearchQuery {
  readonly term: string;
  readonly types?: readonly SearchEntityType[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface SearchMatch {
  readonly entity:
    | { readonly type: "brand"; readonly value: BrandMedicine }
    | { readonly type: "generic"; readonly value: GenericMedicine };
  readonly score: number;
  readonly matchedOn: "name" | "manufacturer" | "therapeutic_class";
}

export interface SearchPage {
  readonly matches: readonly SearchMatch[];
  readonly nextCursor?: string;
}

export interface SearchDocument {
  readonly id: string;
  readonly type: SearchEntityType;
  readonly primaryText: string;
  readonly secondaryText: readonly string[];
}

export interface SearchIndexHit {
  readonly id: string;
  readonly type: SearchEntityType;
  readonly score: number;
  readonly matchedOn: SearchMatch["matchedOn"];
}
