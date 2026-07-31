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
  { type: "reservation.ready.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId"] },
  { type: "reservation.collected.v1", version: 1, aggregate: "reservation", required: ["tenantId", "reservationId"] },
  { type: "payment.authorized.v1", version: 1, aggregate: "payment", required: ["tenantId", "paymentId", "reservationId"] },
  { type: "prescription.uploaded.v1", version: 1, aggregate: "prescription", required: ["tenantId", "prescriptionId", "patientId"] },
  { type: "prescription.validated.v1", version: 1, aggregate: "prescription", required: ["tenantId", "prescriptionId", "scanStatus"] },
  { type: "prescription.stored.v1", version: 1, aggregate: "prescription", required: ["tenantId", "prescriptionId", "fileId"] },
  { type: "prescription.upload.started.v1", version: 1, aggregate: "prescription", required: ["tenantId", "prescriptionId", "workflowId"] },
  { type: "prescription.queued-for-ocr.v1", version: 1, aggregate: "prescription", required: ["tenantId", "prescriptionId", "workflowId"] },
  { type: "prescription.upload.completed.v1", version: 1, aggregate: "prescription", required: ["tenantId", "prescriptionId", "workflowId"] },
] as const;

export function validateEvent(
  contract: VersionedEventContract,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  return contract.required.every((field) => payload[field] !== undefined);
}
