import {
  HumanClinicalReviewRequiredError, IllegalMarTransitionError,
  MarNotFoundError, MarVersionConflictError,
} from "./errors";
import type { MarState, MarTransitionCommand, MarTransitioned, MedicationAccessRequest } from "./models";
import type { Clock, IdGenerator, MarAuditSink, MarIdempotencyStore, MarRepository } from "./ports";

const allowed: Readonly<Record<MarState, readonly MarState[]>> = {
  created: ["validated", "cancelled"],
  validated: ["reviewed", "cancelled"],
  reviewed: ["searching", "cancelled"],
  searching: ["matched", "cancelled"],
  matched: ["reserved", "searching", "cancelled"],
  reserved: ["paid", "matched", "cancelled"],
  paid: ["dispensed", "cancelled"],
  dispensed: ["completed"],
  completed: [],
  cancelled: [],
};

export class MarWorkflowService {
  constructor(
    private readonly repository: MarRepository,
    private readonly audit: MarAuditSink,
    private readonly idempotency: MarIdempotencyStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async transition(command: MarTransitionCommand): Promise<MedicationAccessRequest> {
    const prior = await this.idempotency.find(command.idempotencyKey);
    if (prior) return prior;
    const current = await this.repository.findById(command.tenantId, command.marId);
    if (!current) throw new MarNotFoundError(command.marId);
    if (!allowed[current.state].includes(command.to)) {
      throw new IllegalMarTransitionError(current.state, command.to);
    }
    if (command.to === "reviewed" &&
      (command.actor.kind !== "pharmacist" || command.actor.licenseId.trim() === "")) {
      throw new HumanClinicalReviewRequiredError();
    }
    const now = this.clock.now();
    const updated = await this.repository.transitionAtomically({
      tenantId: command.tenantId, id: command.marId,
      expectedVersion: command.expectedVersion, state: command.to, updatedAt: now,
    });
    if (!updated) throw new MarVersionConflictError();
    const event: MarTransitioned = {
      type: "mar.transitioned", eventId: this.ids.next(), marId: command.marId,
      tenantId: command.tenantId, from: current.state, to: command.to,
      actor: command.actor, occurredAt: now, idempotencyKey: command.idempotencyKey,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
    };
    await this.audit.append(event);
    await this.idempotency.record(command.idempotencyKey, updated);
    return updated;
  }
}
