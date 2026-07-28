import type { DiagnosticRule } from "./diagnostic-rule";
import type { DiagnosticProvider } from "./diagnostic-types";

export class DiagnosticRegistry {
  private readonly providers = new Map<string, DiagnosticProvider>();

  register(provider: DiagnosticProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Diagnostic provider '${provider.name}' is already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  rules(): readonly DiagnosticRule[] {
    return [...this.providers.values()]
      .flatMap((provider) => provider.rules)
      .sort((left, right) => right.priority - left.priority);
  }
}
