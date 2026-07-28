import type { RuntimeContext } from "../index";
import type { DiagnosticSignal } from "./diagnostic-types";

export function diagnosticSignal(
  context: RuntimeContext,
  input: Omit<DiagnosticSignal, "context">,
): DiagnosticSignal {
  return { context, ...input };
}
