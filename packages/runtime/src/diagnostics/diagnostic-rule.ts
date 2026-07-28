import type { DiagnosticFinding, DiagnosticSignal } from "./diagnostic-types";

export interface DiagnosticRule {
  id: string;
  priority: number;
  evaluate(signal: DiagnosticSignal): DiagnosticFinding | undefined;
}
