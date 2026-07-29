export type FulfillmentStage =
  | "locking_inventory"
  | "reserved"
  | "ready"
  | "collected"
  | "compensated"
  | "waiting_for_human";

export interface FulfillmentRun {
  readonly id: string;
  readonly tenantId: string;
  readonly reservationId: string;
  readonly stage: FulfillmentStage;
  readonly inventoryLockId?: string;
  readonly completed: readonly string[];
}

export interface FulfillmentStore {
  find(idempotencyKey: string): Promise<FulfillmentRun | null>;
  begin(input: {
    tenantId: string;
    reservationId: string;
    idempotencyKey: string;
  }): Promise<FulfillmentRun>;
  advance(
    id: string,
    expectedStage: FulfillmentStage,
    stage: FulfillmentStage,
    completedStep: string,
    inventoryLockId?: string,
  ): Promise<FulfillmentRun | null>;
}

export interface FulfillmentPorts {
  lock(run: FulfillmentRun): Promise<{ id: string }>;
  release(run: FulfillmentRun): Promise<void>;
  notify(run: FulfillmentRun, event: "reserved" | "ready" | "collected"): Promise<void>;
  requestHandoff(run: FulfillmentRun, reason: string): Promise<void>;
}

export class FulfillmentConflictError extends Error {
  constructor() {
    super("Fulfillment changed concurrently");
    this.name = new.target.name;
  }
}

export class FulfillmentCoordinator {
  constructor(
    private readonly store: FulfillmentStore,
    private readonly ports: FulfillmentPorts,
  ) {}

  async reserve(input: {
    tenantId: string;
    reservationId: string;
    idempotencyKey: string;
  }): Promise<FulfillmentRun> {
    let run = await this.store.find(input.idempotencyKey)
      ?? await this.store.begin(input);
    if (run.completed.includes("inventory.locked")) return run;
    try {
      const lock = await this.ports.lock(run);
      const advanced = await this.store.advance(
        run.id,
        "locking_inventory",
        "reserved",
        "inventory.locked",
        lock.id,
      );
      if (!advanced) throw new FulfillmentConflictError();
      run = advanced;
      await this.ports.notify(run, "reserved");
      return run;
    } catch (error) {
      if (error instanceof FulfillmentConflictError) throw error;
      await this.ports.requestHandoff(run, "inventory_lock_failed");
      const waiting = await this.store.advance(
        run.id,
        "locking_inventory",
        "waiting_for_human",
        "handoff.requested",
      );
      return waiting ?? run;
    }
  }

  async markReady(run: FulfillmentRun): Promise<FulfillmentRun> {
    const advanced = await this.store.advance(
      run.id,
      "reserved",
      "ready",
      "pickup.ready",
      run.inventoryLockId,
    );
    if (!advanced) throw new FulfillmentConflictError();
    await this.ports.notify(advanced, "ready");
    return advanced;
  }

  async collect(run: FulfillmentRun): Promise<FulfillmentRun> {
    const advanced = await this.store.advance(
      run.id,
      "ready",
      "collected",
      "pickup.collected",
      run.inventoryLockId,
    );
    if (!advanced) throw new FulfillmentConflictError();
    await this.ports.notify(advanced, "collected");
    return advanced;
  }

  async compensate(run: FulfillmentRun): Promise<FulfillmentRun> {
    if (run.stage === "compensated") return run;
    await this.ports.release(run);
    const advanced = await this.store.advance(
      run.id,
      run.stage,
      "compensated",
      "inventory.released",
      run.inventoryLockId,
    );
    if (!advanced) throw new FulfillmentConflictError();
    return advanced;
  }
}
