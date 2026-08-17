import type { RuntimeContext } from "@medlink/runtime";
import { AIGatewayError } from "./errors";

// ENGINE AI-03 -- Prompt Registry. No prompt may be hard-coded inside
// business logic; every prompt this platform sends to a model must be
// declared here first, with an owner, an explicit role gate, and a
// declared input/output contract. This registry is the single place a
// prompt's text and its governance metadata live together.
export interface PromptDefinition {
  readonly id: string;
  readonly version: string;
  readonly owner: string;
  readonly purpose: string;
  readonly allowedRoles: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly template: string;
  readonly rollbackVersion?: string;
}

export interface RenderedPrompt {
  readonly definition: PromptDefinition;
  readonly text: string;
}

const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function templateTokens(template: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const match of template.matchAll(TEMPLATE_TOKEN_PATTERN)) {
    tokens.add(match[1] ?? "");
  }
  return tokens;
}

export class PromptRegistry {
  private readonly byKey = new Map<string, PromptDefinition>();
  private readonly latestVersionById = new Map<string, string>();

  constructor(definitions: readonly PromptDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  // Registration itself enforces the contract, not just documents it: a
  // prompt whose template references a variable absent from
  // requiredInputs (or declares a required input the template never uses)
  // fails to register at all, catching drift between the prompt text and
  // its declared contract before it ever reaches render().
  register(definition: PromptDefinition): void {
    const tokens = templateTokens(definition.template);
    const required = new Set(definition.requiredInputs);
    const undeclaredTokens = [...tokens].filter((token) => !required.has(token));
    const unusedInputs = [...required].filter((input) => !tokens.has(input));
    if (undeclaredTokens.length > 0) {
      throw new Error(
        `Prompt "${definition.id}@${definition.version}" template references undeclared input(s): ${undeclaredTokens.join(", ")}`,
      );
    }
    if (unusedInputs.length > 0) {
      throw new Error(
        `Prompt "${definition.id}@${definition.version}" declares unused required input(s): ${unusedInputs.join(", ")}`,
      );
    }
    const key = `${definition.id}@${definition.version}`;
    if (this.byKey.has(key)) {
      throw new Error(`Prompt "${key}" is already registered -- prompt versions are immutable once registered`);
    }
    this.byKey.set(key, definition);
    this.latestVersionById.set(definition.id, definition.version);
  }

  resolve(id: string, version?: string): PromptDefinition {
    const resolvedVersion = version ?? this.latestVersionById.get(id);
    if (!resolvedVersion) {
      throw new AIGatewayError("prompt_not_found", "validation", 404, `No prompt is registered with id "${id}"`);
    }
    const definition = this.byKey.get(`${id}@${resolvedVersion}`);
    if (!definition) {
      throw new AIGatewayError(
        "prompt_version_not_found",
        "validation",
        404,
        `Prompt "${id}" has no registered version "${resolvedVersion}"`,
      );
    }
    return definition;
  }

  // The rollback path a prompt's own owner declares in advance
  // (rollbackVersion), not an arbitrary earlier version picked at
  // incident time -- keeps rollback deliberate and pre-approved rather
  // than improvised.
  rollback(id: string): PromptDefinition {
    const current = this.resolve(id);
    if (!current.rollbackVersion) {
      throw new AIGatewayError(
        "prompt_version_not_found",
        "validation",
        404,
        `Prompt "${id}@${current.version}" declares no rollbackVersion`,
      );
    }
    return this.resolve(id, current.rollbackVersion);
  }

  // Role authorization happens here, at render time, not left to the
  // caller to remember -- the same "capability declares its own gate"
  // discipline packages/agents' authorizeAgentCapability already applies
  // to agent capabilities, applied here to prompts.
  render(
    context: RuntimeContext,
    id: string,
    inputs: Readonly<Record<string, string>>,
    version?: string,
  ): RenderedPrompt {
    const definition = this.resolve(id, version);
    if (!definition.allowedRoles.includes(context.role)) {
      throw new AIGatewayError(
        "role_not_permitted",
        "authorization",
        403,
        `Role "${context.role}" is not permitted to render prompt "${definition.id}"`,
      );
    }
    const missing = definition.requiredInputs.filter((key) => !(key in inputs));
    if (missing.length > 0) {
      throw new AIGatewayError(
        "missing_required_input",
        "validation",
        400,
        `Prompt "${definition.id}" is missing required input(s): ${missing.join(", ")}`,
      );
    }
    const unrecognized = Object.keys(inputs).filter((key) => !definition.requiredInputs.includes(key));
    if (unrecognized.length > 0) {
      throw new AIGatewayError(
        "unrecognized_input",
        "validation",
        400,
        `Prompt "${definition.id}" received unrecognized input(s): ${unrecognized.join(", ")}`,
      );
    }
    const text = definition.template.replace(TEMPLATE_TOKEN_PATTERN, (_match, token: string) => inputs[token] ?? "");
    return { definition, text };
  }
}
