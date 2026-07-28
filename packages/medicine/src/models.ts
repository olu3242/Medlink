export const medicineStatuses = ["active", "inactive"] as const;
export type MedicineStatus = (typeof medicineStatuses)[number];

export const dosageForms = [
  "tablet",
  "capsule",
  "solution",
  "suspension",
  "injection",
  "cream",
  "ointment",
  "inhaler",
  "drops",
  "suppository",
  "patch",
] as const;
export type DosageForm = (typeof dosageForms)[number];

export const administrationRoutes = [
  "oral",
  "intravenous",
  "intramuscular",
  "subcutaneous",
  "topical",
  "inhaled",
  "ophthalmic",
  "otic",
  "rectal",
  "transdermal",
] as const;
export type AdministrationRoute = (typeof administrationRoutes)[number];

export const strengthUnits = [
  "mcg",
  "mg",
  "g",
  "mg/mL",
  "mcg/mL",
  "units/mL",
  "percent",
] as const;
export type StrengthUnit = (typeof strengthUnits)[number];

export interface IngredientStrength {
  readonly genericId: string;
  readonly amount: number;
  readonly unit: StrengthUnit;
}

export interface GenericMedicine {
  readonly id: string;
  readonly canonicalName: string;
  readonly normalizedName: string;
  readonly therapeuticClass: string;
  readonly controlled: boolean;
  readonly status: MedicineStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BrandMedicine {
  readonly id: string;
  readonly brandName: string;
  readonly normalizedName: string;
  readonly manufacturer: string;
  readonly ingredients: readonly IngredientStrength[];
  readonly dosageForm: DosageForm;
  readonly route: AdministrationRoute;
  readonly status: MedicineStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MedicineReference {
  readonly brandId: string;
  readonly ingredients: readonly IngredientStrength[];
  readonly dosageForm: DosageForm;
  readonly route: AdministrationRoute;
}
