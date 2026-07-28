import type { EvidenceCategory, EvidenceFilter } from "./evidence-types";

export const evidenceCategories: readonly EvidenceCategory[] = [
  "runtime", "observability", "certification", "security", "quality",
];

export function parseEvidenceFilter(url: string): EvidenceFilter {
  const query = new URL(url).searchParams;
  const type = query.get("type");
  const category = query.get("category");
  const correlationId = query.get("correlationId");
  const certificationProfile = query.get("certificationProfile");
  const from = query.get("from");
  const to = query.get("to");
  return {
    ...(type ? { type } : {}),
    ...(category && evidenceCategories.includes(category as EvidenceCategory)
      ? { category: category as EvidenceCategory } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(certificationProfile ? { certificationProfile } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}
