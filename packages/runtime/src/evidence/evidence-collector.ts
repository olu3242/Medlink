import type { EvidenceRepository } from "./evidence-repository";
import type { EvidenceProvider, EvidenceRecord } from "./evidence-types";

export class EvidenceCollector {
  private readonly providers = new Map<string, EvidenceProvider>();
  constructor(private readonly repository: EvidenceRepository) {}
  register(provider: EvidenceProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Evidence provider '${provider.name}' is already registered`);
    }
    this.providers.set(provider.name, provider);
  }
  async collect(): Promise<readonly EvidenceRecord[]> {
    const inputs = (await Promise.all(
      [...this.providers.values()].map((provider) => provider.collect()),
    )).flat();
    return Promise.all(inputs.map((input) => this.repository.create(input)));
  }
}
