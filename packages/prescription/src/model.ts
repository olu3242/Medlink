import { z } from "zod";

export const prescriptionSourceSchema = z.enum(["upload", "electronic"]);
export const prescriptionStatusSchema = z.enum([
  "uploaded",
  "processing",
  "needs_review",
  "validated",
  "rejected",
]);

const confidenceSchema = z.number().min(0).max(1);

export const extractedFieldSchema = z.object({
  value: z.string().trim().min(1),
  confidence: confidenceSchema,
});

export const prescriptionExtractionSchema = z.object({
  patientName: extractedFieldSchema.optional(),
  prescriberName: extractedFieldSchema.optional(),
  medicineName: extractedFieldSchema,
  strength: extractedFieldSchema,
  dosage: extractedFieldSchema,
  quantity: extractedFieldSchema.optional(),
  refills: extractedFieldSchema.optional(),
  overallConfidence: confidenceSchema,
});

export type PrescriptionExtraction = z.infer<
  typeof prescriptionExtractionSchema
>;

export interface PrescriptionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly source: z.infer<typeof prescriptionSourceSchema>;
  readonly status: z.infer<typeof prescriptionStatusSchema>;
  readonly storagePath: string | null;
  readonly extraction: PrescriptionExtraction | null;
}

export interface PrescriptionRepository {
  findById(tenantId: string, prescriptionId: string): Promise<PrescriptionRecord | null>;
  saveExtraction(
    tenantId: string,
    prescriptionId: string,
    extraction: PrescriptionExtraction,
    status: "needs_review",
  ): Promise<PrescriptionRecord>;
}
