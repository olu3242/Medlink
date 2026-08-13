import { createHash } from "node:crypto";
import { basename } from "node:path";
import { fingerprint, makeRunId, type EtlRunResult, type QualityFinding, type SourceAdapter } from "./model";
import { parseCsv, type CsvRecord, normalizeName, normalizeRegistration, normalizeStrength } from "./greenbook";

export function ingest<T>(input: { adapter: SourceAdapter<T>; content: string; filePath: string; authority: string; expectedSha256?: string }): EtlRunResult<T> {
  const started = performance.now(); const sha256 = createHash("sha256").update(input.content).digest("hex");
  if (input.expectedSha256 && sha256 !== input.expectedSha256.toLowerCase()) throw new Error("SOURCE_BASELINE_MISMATCH");
  const parsed = parseCsv(input.content); const records = input.adapter.parse(input.content); const runId = makeRunId(); const seen = new Set<string>(); const findings: QualityFinding[] = [];
  const raw = records.map((record) => {
    const id = input.adapter.sourceRecordId(record); const recordFindings = [...input.adapter.validate(record)];
    if (seen.has(id)) recordFindings.push({ rule: "DUPLICATE_SOURCE_ID", severity: "REJECT", message: `Duplicate source ID ${id}` }); seen.add(id); findings.push(...recordFindings);
    return Object.freeze({ sourceSystem: input.adapter.sourceSystem, sourceRecordId: id, snapshotHash: sha256, raw: Object.freeze(record), findings: Object.freeze(recordFindings) });
  });
  return Object.freeze({ runId, manifest: Object.freeze({ sourceName: input.adapter.sourceSystem, authority: input.authority, fileName: basename(input.filePath), byteSize: Buffer.byteLength(input.content), sha256, rowCount: records.length, columnCount: parsed.columns.length, schemaFingerprint: fingerprint(parsed.columns), schemaVersion: input.adapter.schemaVersion, runId }), records: Object.freeze(raw), findings: Object.freeze(findings), rejected: raw.filter(r=>r.findings.some(f=>f.severity==="REJECT")).length, quarantined: raw.filter(r=>r.findings.some(f=>f.severity==="QUARANTINE")).length, warnings: raw.filter(r=>r.findings.some(f=>f.severity==="WARNING")).length, durationMs: performance.now()-started });
}

export function resolveProducts(products: readonly CsvRecord[], manufacturers: readonly CsvRecord[]) {
  const manufacturerIds = new Set(manufacturers.map(r=>r.manufacturer_id ?? ""));
  const unresolvedManufacturer = products.filter(r=>!manufacturerIds.has(r.manufacturer_id ?? ""));
  const sameNameManufacturers = new Map<string,string[]>();
  for (const row of manufacturers) { const key=normalizeName(row.manufacturer_name ?? ""); sameNameManufacturers.set(key,[...(sameNameManufacturers.get(key)??[]),row.manufacturer_id ?? ""]); }
  const nrnGroups = new Map<string,CsvRecord[]>();
  for (const row of products) { const key=normalizeRegistration(row.NAFDAC ?? ""); if(key) nrnGroups.set(key,[...(nrnGroups.get(key)??[]),row]); }
  const collisions=[...nrnGroups.values()].filter(g=>g.length>1); const ingredientConflicts=collisions.filter(g=>new Set(g.map(r=>r.ingredient_id)).size>1);
  const canonicalKeys=new Set(products.map(r=>[normalizeName(r.product_name ?? ""),r.ingredient_id ?? "",normalizeStrength(r.strength ?? ""),r.form_id ?? "",r.route_id ?? ""].join("|")));
  return { canonicalProductCandidates: canonicalKeys.size, unresolvedManufacturer, sameNameManufacturerGroups:[...sameNameManufacturers.values()].filter(g=>g.length>1), nrnCollisionGroups:collisions.length, ingredientConflictGroups:ingredientConflicts.length };
}
