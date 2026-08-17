import { z } from "zod";
import { RuntimeError } from "@medlink/runtime";

export const canonicalMedicineStatusSchema = z.enum([
  "draft",
  "active",
  "retired",
]);

const boundedText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

export const catalogIngredientSchema = z.object({
  ingredientId: z.string().uuid(),
  preferredName: boundedText(200),
  amount: z.number().positive().nullable(),
  unit: boundedText(80).nullable(),
  primary: z.boolean(),
}).strict();

export const catalogIngredientRecordSchema = z.object({
  id: z.string().uuid(),
  preferredName: boundedText(200),
  description: z.string().nullable(),
}).strict();

export const createCatalogIngredientSchema = z.object({
  preferredName: boundedText(200).min(2),
  description: boundedText(2000).optional(),
}).strict();

export const medicineAliasSchema = z.object({
  id: z.string().uuid(),
  alias: boundedText(300),
  locale: boundedText(20),
}).strict();

export const medicineRegistrationSchema = z.object({
  id: z.string().uuid(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  authorityCode: boundedText(40),
  registrationNumber: boundedText(160),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
}).strict();

export const canonicalMedicineSchema = z.object({
  id: z.string().uuid(),
  brandName: boundedText(200),
  genericName: boundedText(300),
  therapeuticClassId: z.string().uuid().nullable(),
  therapeuticClass: z.string().nullable(),
  dosageForm: boundedText(100),
  route: boundedText(100),
  strength: boundedText(100),
  normalizedStrength: boundedText(100),
  packSize: z.string().nullable(),
  manufacturer: z.string().nullable(),
  controlled: z.boolean(),
  status: canonicalMedicineStatusSchema,
  version: z.number().int().positive(),
  aliases: z.array(medicineAliasSchema),
  ingredients: z.array(catalogIngredientSchema),
  registrations: z.array(medicineRegistrationSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const catalogMedicineSummarySchema = canonicalMedicineSchema.pick({
  id: true,
  brandName: true,
  genericName: true,
  dosageForm: true,
  route: true,
  strength: true,
  normalizedStrength: true,
  manufacturer: true,
  controlled: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
}).strip();

export const catalogIngredientInputSchema = z.object({
  ingredientId: z.string().uuid(),
  amount: z.number().positive().nullable().optional(),
  unit: boundedText(80).nullable().optional(),
  primary: z.boolean().default(false),
}).strict();

export const medicineRegistrationInputSchema = z.object({
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  authorityCode: boundedText(40),
  registrationNumber: boundedText(160),
  validFrom: z.string().date().nullable().optional(),
  validUntil: z.string().date().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (
    value.validFrom
    && value.validUntil
    && value.validUntil < value.validFrom
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validUntil"],
      message: "Registration expiry must not precede its start date",
    });
  }
});

export const saveCatalogMedicineSchema = z.object({
  brandName: boundedText(200),
  genericName: boundedText(300),
  therapeuticClassId: z.string().uuid().nullable().optional(),
  dosageForm: boundedText(100),
  route: boundedText(100),
  strength: boundedText(100),
  packSize: boundedText(160).nullable().optional(),
  manufacturer: boundedText(200).nullable().optional(),
  controlled: z.boolean().default(false),
  status: canonicalMedicineStatusSchema.default("draft"),
  aliases: z.array(boundedText(300)).max(50).default([]),
  ingredients: z.array(catalogIngredientInputSchema).min(1).max(20),
  registrations: z.array(medicineRegistrationInputSchema).max(20).default([]),
}).strict();

export const updateCatalogMedicineSchema = saveCatalogMedicineSchema.extend({
  expectedVersion: z.number().int().positive(),
}).strict();

export const catalogSearchSchema = z.object({
  query: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
}).strict();

export interface CatalogSearchResult {
  readonly medicine: z.infer<typeof catalogMedicineSummarySchema>;
  readonly relevance: number;
  readonly matchedOn:
    | "brand"
    | "generic"
    | "ingredient"
    | "manufacturer"
    | "registration"
    | "synonym";
}

export interface CatalogAlternative {
  readonly id: string;
  readonly sourceMedicineId: string;
  readonly alternative: z.infer<typeof catalogMedicineSummarySchema>;
  readonly kind: "pharmaceutical" | "therapeutic";
  readonly rationale: string;
  readonly clinicalNotes: string | null;
  readonly requiresPharmacistReview: true;
  readonly status: z.infer<typeof canonicalMedicineStatusSchema>;
}

export interface CanonicalMedicineRepository {
  listIngredients(): Promise<
    readonly z.infer<typeof catalogIngredientRecordSchema>[]
  >;
  createIngredient(input: {
    organizationId: string;
    actorId: string;
    value: z.output<typeof createCatalogIngredientSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<z.infer<typeof catalogIngredientRecordSchema>>;
  list(input: {
    query?: string | undefined;
    status?: z.infer<typeof canonicalMedicineStatusSchema> | undefined;
    limit: number;
  }): Promise<{
    items: readonly z.infer<typeof catalogMedicineSummarySchema>[];
    total: number;
  }>;
  find(id: string): Promise<z.infer<typeof canonicalMedicineSchema> | null>;
  search(input: z.output<typeof catalogSearchSchema>): Promise<{
    matches: readonly CatalogSearchResult[];
  }>;
  alternatives(medicineId: string): Promise<readonly CatalogAlternative[]>;
  create(input: {
    organizationId: string;
    actorId: string;
    value: z.output<typeof saveCatalogMedicineSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<z.infer<typeof canonicalMedicineSchema>>;
  update(input: {
    organizationId: string;
    actorId: string;
    medicineId: string;
    value: z.output<typeof updateCatalogMedicineSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<z.infer<typeof canonicalMedicineSchema>>;
  merge(input: {
    organizationId: string;
    actorId: string;
    sourceMedicineId: string;
    targetMedicineId: string;
    expectedSourceVersion: number;
    expectedTargetVersion: number;
    rationale: string;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<{ sourceMedicineId: string; targetMedicineId: string }>;
  createAlternative(input: {
    organizationId: string;
    actorId: string;
    sourceMedicineId: string;
    alternativeMedicineId: string;
    kind: "pharmaceutical" | "therapeutic";
    rationale: string;
    clinicalNotes?: string | undefined;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<CatalogAlternative>;
}

export class CanonicalMedicineNotFoundError extends RuntimeError {
  readonly code = "medicine_not_found";

  constructor() {
    super(
      "business_rule",
      "medicine_not_found",
      "Medicine was not found",
      404,
      false,
    );
    this.name = "CanonicalMedicineNotFoundError";
  }
}

export class CanonicalMedicineCatalog {
  constructor(private readonly repository: CanonicalMedicineRepository) {}

  listIngredients() {
    return this.repository.listIngredients();
  }

  createIngredient(input: Omit<
    Parameters<CanonicalMedicineRepository["createIngredient"]>[0],
    "value"
  > & { value: z.input<typeof createCatalogIngredientSchema> }) {
    return this.repository.createIngredient({
      ...input,
      value: createCatalogIngredientSchema.parse(input.value),
    });
  }

  list(input: {
    query?: string | undefined;
    status?: z.infer<typeof canonicalMedicineStatusSchema> | undefined;
    limit?: number | undefined;
  }) {
    return this.repository.list({ ...input, limit: input.limit ?? 100 });
  }

  async find(id: string) {
    const medicine = await this.repository.find(z.string().uuid().parse(id));
    if (!medicine) throw new CanonicalMedicineNotFoundError();
    return medicine;
  }

  search(input: z.input<typeof catalogSearchSchema>) {
    return this.repository.search(catalogSearchSchema.parse(input));
  }

  alternatives(medicineId: string) {
    return this.repository.alternatives(z.string().uuid().parse(medicineId));
  }

  create(input: {
    organizationId: string;
    actorId: string;
    value: z.input<typeof saveCatalogMedicineSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    return this.repository.create({
      ...input,
      value: saveCatalogMedicineSchema.parse(input.value),
    });
  }

  update(input: {
    organizationId: string;
    actorId: string;
    medicineId: string;
    value: z.input<typeof updateCatalogMedicineSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    return this.repository.update({
      ...input,
      medicineId: z.string().uuid().parse(input.medicineId),
      value: updateCatalogMedicineSchema.parse(input.value),
    });
  }

  merge(input: Parameters<CanonicalMedicineRepository["merge"]>[0]) {
    return this.repository.merge({
      ...input,
      sourceMedicineId: z.string().uuid().parse(input.sourceMedicineId),
      targetMedicineId: z.string().uuid().parse(input.targetMedicineId),
      expectedSourceVersion: z.number().int().positive().parse(
        input.expectedSourceVersion,
      ),
      expectedTargetVersion: z.number().int().positive().parse(
        input.expectedTargetVersion,
      ),
      rationale: boundedText(2000).min(10).parse(input.rationale),
    });
  }

  createAlternative(
    input: Parameters<
      CanonicalMedicineRepository["createAlternative"]
    >[0],
  ) {
    return this.repository.createAlternative({
      ...input,
      sourceMedicineId: z.string().uuid().parse(input.sourceMedicineId),
      alternativeMedicineId: z.string().uuid().parse(
        input.alternativeMedicineId,
      ),
      rationale: boundedText(2000).min(3).parse(input.rationale),
      ...(input.clinicalNotes === undefined
        ? {}
        : { clinicalNotes: boundedText(4000).parse(input.clinicalNotes) }),
    });
  }
}

function compactNumber(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

export function normalizeStrengthDisplay(value: string): string {
  const normalized = value.trim()
    .replaceAll("μ", "u")
    .replace(/\s+/g, " ")
    .replace(/\b(?:ug|mcg)\b/gi, "mcg")
    .replace(/\bmg\b/gi, "mg")
    .replace(/\bg\b/gi, "g")
    .replace(/\bml\b/gi, "mL")
    .replace(/\biu\b/gi, "IU")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*%\s*/g, "%");
  return normalized.replace(
    /(?:^|\/)(\d+(?:\.\d+)?)/g,
    (match, numeric: string) => match.replace(numeric, compactNumber(numeric)),
  );
}
