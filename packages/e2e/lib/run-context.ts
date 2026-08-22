import { randomUUID } from "node:crypto";

export interface CertificationRunContext {
  readonly runId: string;
  readonly commit: string;
  readonly environment: string;
  readonly startedAt: string;
}

export function createRunId(now = new Date(), id: string = randomUUID()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `MEDLINK-E2E-${date}-${id}`;
}

export function createSentinel(runId: string, subject: string): string {
  const normalized = subject.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `E2E-${runId.replace(/^MEDLINK-E2E-/, "")}-${normalized}`;
}
