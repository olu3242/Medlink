// Conservative normalization: no salt, route, release-profile or percentage
// conversions. Concentration denominators remain part of the identity.
export const normalizedText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const scales: Record<string, { dimension: string; factor: number }> = {
  g: { dimension: "mass", factor: 1000 },
  mg: { dimension: "mass", factor: 1 },
  mcg: { dimension: "mass", factor: 0.001 },
  "µg": { dimension: "mass", factor: 0.001 },
  "μg": { dimension: "mass", factor: 0.001 },
  l: { dimension: "volume", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
};
export function normalizedAmount(amount: number | null, unit: string | null): string | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || !unit?.trim()) return null;
  const clean = normalizedText(unit).replace(/\s+/g, "");
  const scale = scales[clean];
  return scale ? `${Number((amount * scale.factor).toPrecision(12))}:${scale.dimension}` : `${amount}:${clean}`;
}
export function normalizedStrength(value: string): string {
  // Preserve component count, but ignore ingredient display order. Ingredient
  // amounts are also compared by stable ingredient ID, never by this string alone.
  return normalizedText(value).replace(/\s+/g, "").split("+").map((component) =>
    component.replace(/(\d+(?:\.\d+)?)(mcg|mg|[µμ]g|ml|g|l)(?![a-z])/g,
      (_match, amount: string, unit: string) => normalizedAmount(Number(amount), unit) ?? "invalid"),
  ).sort().join("+");
}
