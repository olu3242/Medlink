export interface VersionedEventContract {
  readonly type: string;
  readonly version: 1;
  readonly aggregate: string;
  readonly required: readonly string[];
  readonly prohibited?: readonly string[];
}

const prescriptionPhiFields = [
  "patientId",
  "patientName",
  "text",
  "findings",
  "rationale",
  "rawOutput",
  "extraction",
] as const;

function prescriptionEvent(
  type: string,
  required: readonly string[],
): VersionedEventContract {
  return {
    type,
    version: 1,
    aggregate: "prescription",
    required,
    prohibited: prescriptionPhiFields,
  };
}

export const eventContracts: readonly VersionedEventContract[] = [
  {
    type: "conversation.message.accepted.v1",
    version: 1,
    aggregate: "conversation",
    required: ["tenantId", "sessionId", "messageId"],
  },
  {
    type: "conversation.handoff.requested.v1",
    version: 1,
    aggregate: "conversation",
    required: ["tenantId", "sessionId", "reason"],
  },
  {
    type: "mar.transitioned.v1",
    version: 1,
    aggregate: "mar",
    required: ["tenantId", "marId", "from", "to"],
  },
  {
    type: "inventory.locked.v1",
    version: 1,
    aggregate: "inventory",
    required: ["tenantId", "lockId", "reservationId"],
  },
  {
    type: "inventory.batch-updated.v1",
    version: 1,
    aggregate: "inventory_batch",
    required: ["tenantId", "inventoryId", "version", "status", "contentSha256"],
  },
  ...[
    "received",
    "dispensed",
    "reserved",
    "released",
    "adjusted",
    "expired",
    "returned",
  ].map((action): VersionedEventContract => ({
    type: `inventory.${action}.v1`,
    version: 1,
    aggregate: "inventory_batch",
    required: [
      "tenantId",
      "inventoryId",
      "transactionId",
      "pharmacyLocationId",
      "medicineId",
      "kind",
      "quantityDelta",
      "reservedDelta",
      "version",
      "contentSha256",
    ],
  })),
  {
    type: "inventory.low.v1",
    version: 1,
    aggregate: "inventory_batch",
    required: [
      "tenantId",
      "inventoryId",
      "pharmacyLocationId",
      "medicineId",
      "availableQuantity",
      "lowStockThreshold",
      "version",
    ],
  },
  {
    type: "reservation.created.v1",
    version: 1,
    aggregate: "reservation",
    required: ["tenantId", "reservationId", "marId"],
  },
  {
    type: "reservation.ready.v1",
    version: 1,
    aggregate: "reservation",
    required: ["tenantId", "reservationId"],
  },
  {
    type: "reservation.collected.v1",
    version: 1,
    aggregate: "reservation",
    required: ["tenantId", "reservationId"],
  },
  {
    type: "reservation.credential_issued.v1",
    version: 1,
    aggregate: "reservation",
    required: ["tenantId", "reservationId"],
    // The patient-generated pickup credential is never part of this event
    // -- only the reservations table stores its hash, and this event
    // carries no field for it at all (see
    // packages/notifications/src/reservation-outbox.ts, which registers
    // no consumer for this event type: it never reaches WhatsApp).
    prohibited: ["pickupCode", "pickupCodeHash", "credential"],
  },
  {
    type: "payment.authorized.v1",
    version: 1,
    aggregate: "payment",
    required: ["tenantId", "paymentId", "reservationId"],
  },
  {
    type: "payment.attempt-created.v1",
    version: 1,
    aggregate: "payment",
    required: ["tenantId", "paymentId", "reservationId", "attemptId"],
  },
  {
    type: "medicine.catalog-created.v1",
    version: 1,
    aggregate: "medicine",
    required: ["tenantId", "medicineId", "version", "status", "contentSha256"],
  },
  {
    type: "medicine.ingredient-created.v1",
    version: 1,
    aggregate: "active_ingredient",
    required: ["tenantId", "ingredientId", "contentSha256"],
  },
  {
    type: "medicine.catalog-updated.v1",
    version: 1,
    aggregate: "medicine",
    required: ["tenantId", "medicineId", "version", "status", "contentSha256"],
  },
  {
    type: "medicine.catalog-merged.v1",
    version: 1,
    aggregate: "medicine",
    required: [
      "tenantId",
      "sourceMedicineId",
      "targetMedicineId",
      "sourceVersion",
      "targetVersion",
      "contentSha256",
    ],
  },
  {
    type: "medicine.alternative-created.v1",
    version: 1,
    aggregate: "medicine",
    required: [
      "tenantId",
      "alternativeId",
      "sourceMedicineId",
      "alternativeMedicineId",
      "kind",
      "requiresPharmacistReview",
      "contentSha256",
    ],
  },
  prescriptionEvent("prescription.upload.started.v1", [
    "tenantId", "prescriptionId", "workflowId",
  ]),
  prescriptionEvent("prescription.uploaded.v1", [
    "tenantId", "prescriptionId", "extractionId", "fileId",
  ]),
  prescriptionEvent("prescription.validated.v1", [
    "tenantId", "prescriptionId", "scanStatus",
  ]),
  prescriptionEvent("prescription.stored.v1", [
    "tenantId", "prescriptionId", "fileId",
  ]),
  prescriptionEvent("prescription.queued-for-ocr.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "fileId",
  ]),
  prescriptionEvent("prescription.upload.completed.v1", [
    "tenantId", "prescriptionId", "workflowId",
  ]),
  prescriptionEvent("prescription.manual-created.v1", [
    "tenantId", "prescriptionId", "workflowId", "contentSha256", "status",
  ]),
  prescriptionEvent("prescription.manual-draft-updated.v1", [
    "tenantId", "prescriptionId", "workflowId", "contentSha256", "version",
  ]),
  prescriptionEvent("prescription.manual-draft-deleted.v1", [
    "tenantId", "prescriptionId", "version",
  ]),
  prescriptionEvent("prescription.manual-submitted.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "contentSha256",
  ]),
  prescriptionEvent("prescription.ocr.completed.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "ocrResultId", "resultSha256", "confidence",
  ]),
  prescriptionEvent("prescription.ocr.low-confidence.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "ocrResultId", "confidence",
  ]),
  prescriptionEvent("prescription.queued-for-parsing.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "fileId", "ocrResultId",
  ]),
  prescriptionEvent("prescription.parsed.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "extractionSha256", "confidence", "itemCount",
  ]),
  prescriptionEvent("prescription.ambiguity-detected.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "confidence",
  ]),
  prescriptionEvent("prescription.queued-for-clinical-validation.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "fileId", "ocrResultId", "extractionSha256", "confidence",
  ]),
  prescriptionEvent("prescription.clinical-validation.completed.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "findingCount",
  ]),
  prescriptionEvent("prescription.clinical-packet.generated.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "evidenceId", "contentSha256",
  ]),
  prescriptionEvent("prescription.pharmacist-review.requested.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "evidenceId",
  ]),
  prescriptionEvent("prescription.medicine-resolution-recorded.v1", [
    "tenantId", "prescriptionId", "validationId", "itemCount",
    "contentSha256",
  ]),
  prescriptionEvent("prescription.clarification-responded.v1", [
    "tenantId", "prescriptionId", "clarificationId", "validationId",
    "workflowId",
  ]),
  prescriptionEvent("prescription.pharmacist-review.completed.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "evidenceId", "decision",
  ]),
  prescriptionEvent("prescription.clinically-approved.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "evidenceId", "decision",
  ]),
  prescriptionEvent("prescription.clinically-rejected.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "evidenceId", "decision",
  ]),
  prescriptionEvent("prescription.clarification-requested.v1", [
    "tenantId", "prescriptionId", "extractionId", "pipelineId",
    "workflowId", "validationId", "evidenceId", "decision",
  ]),
] as const;

function containsProhibitedField(
  value: unknown,
  prohibited: ReadonlySet<string>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsProhibitedField(entry, prohibited));
  }
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, entry]) =>
    prohibited.has(key.toLowerCase())
    || containsProhibitedField(entry, prohibited));
}

export function validateEvent(
  contract: VersionedEventContract,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  const required = contract.required.every((field) =>
    payload[field] !== undefined && payload[field] !== null);
  if (!required || !contract.prohibited) return required;
  const prohibited = new Set(
    contract.prohibited.map((field) => field.toLowerCase()),
  );
  return !containsProhibitedField(payload, prohibited);
}
