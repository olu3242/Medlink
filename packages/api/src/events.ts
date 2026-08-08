export interface VersionedEventContract {
  readonly type: string;
  readonly version: 1;
  readonly aggregate: string;
  readonly required: readonly string[];
}

export const eventContracts: readonly VersionedEventContract[] = [
  { type: "conversation.message.accepted.v1", version: 1, aggregate: "conversation", required: ["tenantId", "sessionId", "messageId"] },
  { type: "conversation.handoff.requested.v1", version: 1, aggregate: "conversation", required: ["tenantId", "sessionId", "reason"] },
  { type: "mar.transitioned.v1", version: 1, aggregate: "mar", required: ["tenantId", "marId", "from", "to"] },
  { type: "inventory.locked.v1", version: 1, aggregate: "inventory", required: ["tenantId", "lockId", "reservationId"] },
  { type: "reservation.created.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId", "marId"] },
  { type: "reservation.confirmed.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId"] },
  { type: "reservation.cancelled.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId", "reason"] },
  { type: "reservation.ready.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId"] },
  { type: "reservation.collected.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId"] },
  { type: "payment.authorized.v1", version: 1, aggregate: "payment", required: ["tenantId", "paymentId", "reservationId"] },
] as const;

export function validateEvent(
  contract: VersionedEventContract,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return contract.required.every((field) => payload[field] !== undefined);
}
