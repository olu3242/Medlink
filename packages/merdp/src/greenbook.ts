import type { QualityFinding, SourceAdapter } from "./model";

export const productColumns = ["product_id","ingredient_id","manufacturer_id","product_name","form_id","strength","NAFDAC","product_category_id","marketing_category_id","applicant_id","approval_date","expiry_date","route_id","smpc","country_id","product_description","pack_size","biosimilar","atc","created_at","updated_at","deleted_at","status","composition","ingredient","form","applicant","route","product_category","category_name","ingredient_name","synonym","form_name","applicant_name","route_name","DT_RowIndex"] as const;
export const manufacturerColumns = ["manufacturer_id","manufacturer_name","product_count","ingredient_count","detail_url","source_page","source_position","retrieved_at"] as const;
export const manufacturerProductColumns = ["manufacturer_source_id","manufacturer_source_name","product_id","product_name","nrn","composition","detail_source_url","retrieved_at"] as const;

export type CsvRecord = Readonly<Record<string, string>>;

export function parseCsv(content: string): { columns: string[]; rows: CsvRecord[] } {
  const matrix: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  const text = content.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(value); value = ""; if (row.some((entry) => entry !== "")) matrix.push(row); row = [];
    } else value += char;
  }
  if (value || row.length) { row.push(value); matrix.push(row); }
  const columns = matrix.shift() ?? [];
  return { columns, rows: matrix.map((cells) => Object.freeze(Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""])))) };
}

function dateFinding(record: CsvRecord, field: string): QualityFinding[] {
  const value = record[field];
  return value && Number.isNaN(Date.parse(value)) ? [{ rule: "GREENBOOK_DATE_PARSE", severity: "QUARANTINE", field, message: `Unparseable ${field}` }] : [];
}

export class GreenbookProductAdapter implements SourceAdapter<CsvRecord> {
  readonly sourceSystem = "NAFDAC_GREENBOOK"; readonly schemaVersion = "greenbook-product-v1";
  parse(content: string) { const parsed = parseCsv(content); if (parsed.columns.join("|") !== productColumns.join("|")) throw new Error("SOURCE_SCHEMA_MISMATCH"); return parsed.rows; }
  sourceRecordId(record: CsvRecord) { return record.product_id ?? ""; }
  validate(record: CsvRecord): QualityFinding[] {
    const findings: QualityFinding[] = [];
    if (!record.product_id) findings.push({ rule: "SOURCE_ID_REQUIRED", severity: "REJECT", field: "product_id", message: "Missing source product_id" });
    for (const field of ["strength","atc","pack_size","synonym","form_name","route_name"]) if (!record[field]) findings.push({ rule: `OPTIONAL_${field.toUpperCase()}_MISSING`, severity: "WARNING", field, message: `Missing optional ${field}` });
    if (!record.NAFDAC) findings.push({ rule: "REGULATORY_ID_MISSING", severity: "QUARANTINE", field: "NAFDAC", message: "Missing NAFDAC/NRN" });
    const governedCategories = new Set(["Drugs","Medical devices","Vaccines and Biologics","Herbals and Nutraceuticals","Veterinary"]);
    if (!governedCategories.has(record.category_name ?? "")) findings.push({ rule: "CATEGORY_UNCLASSIFIED", severity: "QUARANTINE", field: "category_name", message: "Unknown or unclassified products require review" });
    findings.push(...dateFinding(record, "approval_date"), ...dateFinding(record, "expiry_date")); return findings;
  }
}

export class GreenbookManufacturerAdapter implements SourceAdapter<CsvRecord> {
  readonly sourceSystem = "NAFDAC_GREENBOOK_MANUFACTURERS"; readonly schemaVersion = "greenbook-manufacturer-v1";
  parse(content: string) { const parsed = parseCsv(content); if (parsed.columns.join("|") !== manufacturerColumns.join("|")) throw new Error("SOURCE_SCHEMA_MISMATCH"); return parsed.rows; }
  sourceRecordId(record: CsvRecord) { return record.manufacturer_id ?? ""; }
  validate(record: CsvRecord): QualityFinding[] { return !record.manufacturer_id ? [{ rule: "SOURCE_ID_REQUIRED", severity: "REJECT", field: "manufacturer_id", message: "Missing source manufacturer_id" }] : !record.manufacturer_name ? [{ rule: "MANUFACTURER_NAME_MISSING", severity: "QUARANTINE", field: "manufacturer_name", message: "Missing manufacturer name" }] : []; }
}

export class GreenbookManufacturerProductAdapter implements SourceAdapter<CsvRecord> {
  readonly sourceSystem = "NAFDAC_GREENBOOK_MANUFACTURER_PRODUCTS"; readonly schemaVersion = "greenbook-manufacturer-product-v1";
  parse(content: string) { const parsed = parseCsv(content); if (parsed.columns.join("|") !== manufacturerProductColumns.join("|")) throw new Error("SOURCE_SCHEMA_MISMATCH"); return parsed.rows; }
  sourceRecordId(record: CsvRecord) { return `${record.manufacturer_source_id ?? ""}:${record.product_id ?? ""}`; }
  validate(record: CsvRecord): QualityFinding[] {
    const findings: QualityFinding[] = [];
    if (!record.manufacturer_source_id) findings.push({ rule: "SOURCE_MANUFACTURER_ID_REQUIRED", severity: "REJECT", field: "manufacturer_source_id", message: "Missing source manufacturer ID" });
    if (!record.product_id) findings.push({ rule: "SOURCE_PRODUCT_ID_REQUIRED", severity: "REJECT", field: "product_id", message: "Missing Greenbook product ID" });
    if (!record.product_name) findings.push({ rule: "PRODUCT_NAME_MISSING", severity: "QUARANTINE", field: "product_name", message: "Missing product name" });
    return findings;
  }
}

export function normalizeName(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en"); }
export function normalizeRegistration(value: string): string { return value; }
export function normalizeStrength(value: string): string { return value.trim().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").replace(/\bmg\b/gi,"mg").replace(/\bml\b/gi,"mL").replace(/\bmcg\b/gi,"mcg"); }
