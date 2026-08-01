import { normalizeMedicineName } from "@medlink/medicine";
import type {
  MedicineSearchQuery,
  SearchMatch,
  SearchPage,
} from "./contracts";
import { SearchUnavailableError } from "./errors";
import type { MedicineSearchIndex, SearchMedicineReader } from "./ports";
import { parseMedicineSearchQuery } from "./validation";

export interface MedicineSearchService {
  search(query: MedicineSearchQuery): Promise<SearchPage>;
}

export class IndexedMedicineSearchService implements MedicineSearchService {
  constructor(
    private readonly index: MedicineSearchIndex,
    private readonly medicines: SearchMedicineReader,
  ) {}

  async search(query: MedicineSearchQuery): Promise<SearchPage> {
    const valid = parseMedicineSearchQuery(query);
    const types = valid.types ?? ["brand", "generic"];

    try {
      const page = await this.index.search({
        normalizedTerm: normalizeMedicineName(valid.term),
        types,
        limit: valid.limit ?? 20,
        ...(valid.cursor === undefined ? {} : { cursor: valid.cursor }),
      });
      const brandIds = page.hits
        .filter(({ type }) => type === "brand")
        .map(({ id }) => id);
      const genericIds = page.hits
        .filter(({ type }) => type === "generic")
        .map(({ id }) => id);
      const [brands, generics] = await Promise.all([
        this.medicines.findBrandsByIds(brandIds),
        this.medicines.findGenericsByIds(genericIds),
      ]);
      const brandById = new Map(brands.map((value) => [value.id, value]));
      const genericById = new Map(generics.map((value) => [value.id, value]));
      const matches: SearchMatch[] = [];

      for (const hit of page.hits) {
        if (hit.type === "brand") {
          const value = brandById.get(hit.id);
          if (value?.status === "active") {
            matches.push({
              entity: { type: "brand", value },
              score: hit.score,
              matchedOn: hit.matchedOn,
            });
          }
        } else {
          const value = genericById.get(hit.id);
          if (value?.status === "active") {
            matches.push({
              entity: { type: "generic", value },
              score: hit.score,
              matchedOn: hit.matchedOn,
            });
          }
        }
      }

      return {
        matches,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    } catch (error) {
      if (error instanceof SearchUnavailableError) throw error;
      throw new SearchUnavailableError(error);
    }
  }
}
