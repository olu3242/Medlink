import { z } from "zod";

export const prescriptionSourceSchema = z.enum([
  "upload",
  "electronic",
  "manual",
]);
export const prescriptionStatusSchema = z.enum([
  "received",
  "extracting",
  "needs_review",
  "validated",
  "rejected",
]);

const confidenceSchema = z.number().min(0).max(1);

export const extractedFieldSchema = z.object({
  value: z.string().trim().min(1).max(2_000),
  confidence: confidenceSchema,
}).strict();

export const prescriptionExtractionSchema = z.object({
  patientName: extractedFieldSchema.optional(),
  prescriberName: extractedFieldSchema.optional(),
  medicineName: extractedFieldSchema,
  strength: extractedFieldSchema,
  dosage: extractedFieldSchema,
  quantity: extractedFieldSchema.optional(),
  refills: extractedFieldSchema.optional(),
  overallConfidence: confidenceSchema,
}).strict();

export const structuredPrescriptionItemSchema = z.object({
  medicineName: extractedFieldSchema,
  strength: extractedFieldSchema,
  dosage: extractedFieldSchema,
  quantity: extractedFieldSchema.optional(),
  refills: extractedFieldSchema.optional(),
}).strict();

export const structuredPrescriptionSchema = z.object({
  patientName: extractedFieldSchema.optional(),
  prescriberName: extractedFieldSchema.optional(),
  items: z.array(structuredPrescriptionItemSchema).min(1).max(30),
  overallConfidence: confidenceSchema,
}).strict();

export type StructuredPrescription = z.infer<
  typeof structuredPrescriptionSchema
>;

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
