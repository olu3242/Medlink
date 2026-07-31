import { createHash } from "node:crypto";
import type { EvidenceInput } from "./evidence-types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)).map(([key, item]) =>
      `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function evidenceHash(input: EvidenceInput, version: number): string {
  return createHash("sha256").update(canonical({ ...input, version })).digest("hex");
}
