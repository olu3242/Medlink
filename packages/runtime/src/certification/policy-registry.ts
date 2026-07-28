import type { CertificationPolicy, CertificationProvider } from "./policy-types";

export class PolicyRegistry {
  private readonly providers = new Map<string, CertificationProvider>();
  register(provider: CertificationProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Certification provider '${provider.name}' is already registered`);
    }
    this.providers.set(provider.name, provider);
  }
  policies(): readonly CertificationPolicy[] {
    return [...this.providers.values()].flatMap((provider) => provider.policies);
  }
}
