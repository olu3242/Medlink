import { z } from "zod";
import {
  prescriptionSourceSchema,
  prescriptionStatusSchema,
} from "./model";

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();
const requiredText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

export const manualPrescriptionItemSchema = z.object({
  medicineId: z.string().uuid(),
  strength: requiredText(100),
  dosage: requiredText(500),
  route: optionalText(100),
  frequency: optionalText(200),
  duration: optionalText(200),
  quantity: z.number().positive().max(1_000_000).optional(),
  quantityUnit: optionalText(80),
  refills: z.number().int().min(0).max(100).optional(),
  directions: optionalText(2_000),
}).strict();

const manualPrescriptionFields = {
  prescriberName: optionalText(240),
  facilityName: optionalText(240),
  notes: optionalText(4_000),
  prescribedAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  items: z.array(manualPrescriptionItemSchema).min(1).max(30),
};

function chronological(
  value: { prescribedAt?: string | undefined; expiresAt?: string | undefined },
  context: z.RefinementCtx,
) {
  if (
    value.prescribedAt
    && value.expiresAt
    && Date.parse(value.expiresAt) < Date.parse(value.prescribedAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "Expiry must not precede the prescription date",
    });
  }
}

export const createManualPrescriptionSchema = z.object({
  ...manualPrescriptionFields,
  submit: z.boolean().default(true),
}).strict().superRefine(chronological);

export const updateManualPrescriptionSchema = z.object({
  ...manualPrescriptionFields,
  expectedVersion: z.number().int().positive(),
  submit: z.boolean().default(false),
}).strict().superRefine(chronological);

export type CreateManualPrescription = z.input<
  typeof createManualPrescriptionSchema
>;
export type UpdateManualPrescription = z.input<
  typeof updateManualPrescriptionSchema
>;

export const prescriptionReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "needs_information",
]);

export interface PrescriptionSummary {
  readonly id: string;
  readonly source: z.infer<typeof prescriptionSourceSchema>;
  readonly status: z.infer<typeof prescriptionStatusSchema>;
  readonly reviewStatus: z.infer<typeof prescriptionReviewStatusSchema> | null;
  readonly prescriberName: string | null;
  readonly facilityName: string | null;
  readonly prescribedAt: string | null;
  readonly expiresAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ManagedPrescriptionItem {
  readonly id: string;
  readonly lineNumber: number;
  readonly medicineId: string | null;
  readonly enteredMedicineName: string;
  readonly brandName: string | null;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly dosage: string | null;
  readonly dosageForm: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly duration: string | null;
  readonly quantity: number | null;
  readonly quantityUnit: string | null;
  readonly refills: number | null;
  readonly directions: string | null;
  readonly manualOverride: boolean;
  readonly confidence: number | null;
}

export interface PrescriptionDetail extends PrescriptionSummary {
  readonly patientId: string;
  readonly notes: string | null;
  readonly items: readonly ManagedPrescriptionItem[];
}

export interface ManualPrescriptionResult {
  readonly prescriptionId: string;
  readonly status: "received" | "needs_review";
  readonly version: number;
  readonly reviewId: string | null;
  readonly workflowId: string | null;
}

export interface PrescriptionManagementRepository {
  list(
    tenantId: string,
    patientId: string,
  ): Promise<readonly PrescriptionSummary[]>;
  find(
    tenantId: string,
    patientId: string,
    prescriptionId: string,
  ): Promise<PrescriptionDetail | null>;
  createManual(input: {
    tenantId: string;
    patientId: string;
    actorId: string;
    value: z.output<typeof createManualPrescriptionSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<ManualPrescriptionResult>;
  updateManual(input: {
    tenantId: string;
    patientId: string;
    actorId: string;
    prescriptionId: string;
    value: z.output<typeof updateManualPrescriptionSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<ManualPrescriptionResult>;
  removeManualDraft(input: {
    tenantId: string;
    patientId: string;
    actorId: string;
    prescriptionId: string;
    expectedVersion: number;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<{ prescriptionId: string; deleted: true }>;
}

export class ManagedPrescriptionNotFoundError extends Error {
  readonly code = "prescription_not_found";

  constructor() {
    super("Prescription was not found");
    this.name = "ManagedPrescriptionNotFoundError";
  }
}

export class PrescriptionManagementService {
  constructor(private readonly repository: PrescriptionManagementRepository) {}

  list(tenantId: string, patientId: string) {
    return this.repository.list(tenantId, patientId);
  }

  async find(
    tenantId: string,
    patientId: string,
    prescriptionId: string,
  ) {
    const prescription = await this.repository.find(
      tenantId,
      patientId,
      z.string().uuid().parse(prescriptionId),
    );
    if (!prescription) throw new ManagedPrescriptionNotFoundError();
    return prescription;
  }

  async createManual(input: {
    tenantId: string;
    patientId: string;
    actorId: string;
    value: CreateManualPrescription;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    return this.repository.createManual({
      ...input,
      value: createManualPrescriptionSchema.parse(input.value),
    });
  }

  async updateManual(input: {
    tenantId: string;
    patientId: string;
    actorId: string;
    prescriptionId: string;
    value: UpdateManualPrescription;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    return this.repository.updateManual({
      ...input,
      prescriptionId: z.string().uuid().parse(input.prescriptionId),
      value: updateManualPrescriptionSchema.parse(input.value),
    });
  }

  async removeManualDraft(input: {
    tenantId: string;
    patientId: string;
    actorId: string;
    prescriptionId: string;
    expectedVersion: number;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    return this.repository.removeManualDraft({
      ...input,
      prescriptionId: z.string().uuid().parse(input.prescriptionId),
      expectedVersion: z.number().int().positive().parse(input.expectedVersion),
    });
  }
}
