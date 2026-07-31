import type { RuntimeErrorCategory } from "../index";
import type { DiagnosticCategory, DiagnosticSeverity } from "./diagnostic-types";

export function failureCategory(
  category?: RuntimeErrorCategory,
  code = "",
): DiagnosticCategory {
  if (code.includes("timeout")) return "dependency_timeout";
  if (code.includes("rollback")) return "transaction_rollback";
  if (code.includes("dead_letter")) return "dead_letter_accumulation";
  if (code.includes("configuration")) return "configuration_error";
  if (category === "validation") return "validation_failure";
  if (category === "authentication") return "authentication_failure";
  if (category === "authorization") return "authorization_failure";
  if (category === "external_dependency") return "connection_failure";
  return "runtime_failure";
}

export function failureSeverity(
  category: DiagnosticCategory,
  retryable = false,
): DiagnosticSeverity {
  if (category === "validation_failure") return "info";
  if (category === "authentication_failure" || category === "authorization_failure") {
    return "warning";
  }
  if (category === "startup_failure" || category === "resource_exhaustion") {
    return "critical";
  }
  return retryable ? "warning" : "error";
}
