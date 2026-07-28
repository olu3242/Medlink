import type { HealthCheckProvider } from "./health-types";

export class HealthRegistry {
  private readonly providers = new Map<string, HealthCheckProvider>();

  register(provider: HealthCheckProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Health provider '${provider.name}' is already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  all(): readonly HealthCheckProvider[] {
    return [...this.providers.values()];
  }
}
