import type { DiagnosticFinding, DiagnosticSignal } from "./diagnostic-types";

export function correlateRootCause(
  signal: DiagnosticSignal,
  finding: DiagnosticFinding,
): DiagnosticFinding {
  const rootCause = finding.rootCause
    ?? (signal.errorCode ? `runtime:${signal.errorCode}` : undefined);
  return {
    ...finding,
    ...(rootCause ? { rootCause } : {}),
    evidence: [...new Set([...finding.evidence, ...signal.evidence])],
  };
}
