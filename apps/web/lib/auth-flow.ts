export function safeAuthNext(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "https://medlink.invalid");
    return url.origin === "https://medlink.invalid" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

type AuthFailure = { code?: string | undefined; message?: string | undefined; status?: number | undefined };

export function authFailureCode(error: AuthFailure): "rate_limited" | "invalid_email" | "provider_unavailable" | "configuration_error" | "sign_in_failed" {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";
  if (error.status === 429 || code.includes("rate_limit") || message.includes("rate limit")) return "rate_limited";
  if (code.includes("email") && (code.includes("invalid") || message.includes("invalid"))) return "invalid_email";
  if (code.includes("config") || message.includes("configuration") || message.includes("not configured")) return "configuration_error";
  if (error.status === 502 || error.status === 503 || error.status === 504 || code.includes("provider") || message.includes("provider")) return "provider_unavailable";
  return "sign_in_failed";
}
