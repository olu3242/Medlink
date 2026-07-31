export interface ArchitectureComponent {
  readonly id: string;
  readonly boundedContext: string;
  readonly owner: string;
  readonly layer: "app" | "api" | "workflow" | "domain" | "runtime" | "data";
  readonly dependencies: readonly string[];
  readonly ownsRuntime: boolean;
  readonly apiContractValid: boolean;
  readonly eventContractValid: boolean;
  readonly schemaEvolutionValid: boolean;
  readonly certificationDependenciesSatisfied: boolean;
}

export function detectArchitectureDrift(
  components: readonly ArchitectureComponent[],
): {
  readonly passed: boolean;
  readonly violations: readonly string[];
  readonly remediation: readonly string[];
} {
  const violations: string[] = [];
  const ids = new Set(components.map((component) => component.id));
  const runtimeOwners = components.filter((component) => component.ownsRuntime);
  if (runtimeOwners.length > 1) violations.push("duplicate_runtime_ownership");
  const visit = (id: string, path: readonly string[]): void => {
    if (path.includes(id)) {
      violations.push(`cyclic_dependency:${[...path, id].join(">")}`);
      return;
    }
    const component = components.find((item) => item.id === id);
    for (const dependency of component?.dependencies ?? []) {
      if (!ids.has(dependency)) violations.push(`dependency_missing:${id}:${dependency}`);
      else visit(dependency, [...path, id]);
    }
  };
  for (const component of components) {
    visit(component.id, []);
    if (!component.owner) violations.push(`owner_missing:${component.id}`);
    if (!component.apiContractValid) violations.push(`api_contract:${component.id}`);
    if (!component.eventContractValid) violations.push(`event_contract:${component.id}`);
    if (!component.schemaEvolutionValid) violations.push(`schema_evolution:${component.id}`);
    if (!component.certificationDependenciesSatisfied) {
      violations.push(`certification_dependency:${component.id}`);
    }
  }
  const unique = [...new Set(violations)];
  return {
    passed: unique.length === 0,
    violations: unique,
    remediation: unique.map((violation) => `remediate:${violation}`),
  };
}
