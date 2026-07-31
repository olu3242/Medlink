export type OperationalCapability =
  | "payment"
  | "adherence"
  | "analytics"
  | "reporting"
  | "ai"
  | "governance"
  | "partner_integration"
  | "security"
  | "certification";

export interface AdapterContext {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface OperationalAdapter<I = unknown, O = unknown> {
  readonly capability: OperationalCapability;
  health(): Promise<{ readonly available: boolean; readonly detail?: string }>;
  execute(context: AdapterContext, input: I): Promise<O>;
}

export interface AdapterJournal {
  find(capability: OperationalCapability, idempotencyKey: string): Promise<unknown | null>;
  commit(entry: {
    capability: OperationalCapability;
    context: AdapterContext;
    output: unknown;
  }): Promise<void>;
}

export class AdapterUnavailableError extends Error {
  constructor(readonly capability: OperationalCapability) {
    super(`Operational adapter '${capability}' is unavailable`);
    this.name = new.target.name;
  }
}

export class OperationalAdapterRegistry {
  constructor(
    private readonly adapters: readonly OperationalAdapter[],
    private readonly journal: AdapterJournal,
  ) {}

  async invoke<I, O>(
    capability: OperationalCapability,
    context: AdapterContext,
    input: I,
  ): Promise<O> {
    const prior = await this.journal.find(capability, context.idempotencyKey);
    if (prior !== null) return prior as O;
    const adapter = this.adapters.find((candidate) => candidate.capability === capability);
    if (!adapter || !(await adapter.health()).available) {
      throw new AdapterUnavailableError(capability);
    }
    const output = await adapter.execute(context, input);
    await this.journal.commit({ capability, context, output });
    return output as O;
  }

  async readiness(): Promise<Readonly<Record<OperationalCapability, boolean>>> {
    const capabilities: readonly OperationalCapability[] = [
      "payment", "adherence", "analytics", "reporting", "ai", "governance",
      "partner_integration", "security", "certification",
    ];
    const entries = await Promise.all(capabilities.map(async (capability) => {
      const adapter = this.adapters.find((candidate) => candidate.capability === capability);
      return [capability, adapter ? (await adapter.health()).available : false] as const;
    }));
    return Object.fromEntries(entries) as Readonly<Record<OperationalCapability, boolean>>;
  }
}
