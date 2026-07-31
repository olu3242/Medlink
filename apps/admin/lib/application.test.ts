import { describe, expect, it } from "vitest";
import { toMedicineDetail, toMedicineSummary, type MedicineRow } from "./application";

const rowWithoutUpdatedAt: MedicineRow = {
  id: "00000000-0000-4000-8000-000000000001",
  brand_name: "Panadol",
  generic_name: "Paracetamol",
  dosage_form: "tablet",
  route: "oral",
  strength_display: "500 mg",
  manufacturer_name: "GSK",
  controlled_substance: false,
  status: "active",
};

const row: MedicineRow = {
  ...rowWithoutUpdatedAt,
  updated_at: "2026-07-29T00:00:00.000Z",
};

describe("toMedicineSummary", () => {
  it("maps the medicines table's snake_case columns to the camelCase MedicineSummary contract", () => {
    expect(toMedicineSummary(row)).toEqual({
      id: row.id,
      name: "Panadol",
      genericName: "Paracetamol",
      strength: "500 mg",
      dosageForm: "tablet",
      status: "active",
    });
  });
});

describe("toMedicineDetail", () => {
  it("extends the summary with route, controlled, manufacturer, and updatedAt", () => {
    expect(toMedicineDetail(row)).toEqual({
      id: row.id,
      name: "Panadol",
      genericName: "Paracetamol",
      strength: "500 mg",
      dosageForm: "tablet",
      status: "active",
      route: "oral",
      controlled: false,
      manufacturer: "GSK",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
  });

  it("omits manufacturer and updatedAt rather than emitting null/undefined when absent", () => {
    const detail = toMedicineDetail({ ...rowWithoutUpdatedAt, manufacturer_name: null });
    expect(detail).not.toHaveProperty("manufacturer");
    expect(detail).not.toHaveProperty("updatedAt");
  });
});
