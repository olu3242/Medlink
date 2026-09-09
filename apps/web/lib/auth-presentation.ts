export const authErrorMessages: Readonly<Record<string, string>> = {
  invalid_email: "Enter a valid email address.",
  rate_limited: "Too many sign-in links were requested. Wait a few minutes before trying again.",
  provider_unavailable: "The email sign-in provider is temporarily unavailable. Try again shortly.",
  configuration_error: "Secure sign-in is temporarily unavailable because this environment is not configured correctly.",
  sign_in_failed: "The authentication service could not start sign-in. Check your connection and try again.",
  missing_code: "This sign-in link is incomplete. Request a new secure link.",
  callback_failed: "This sign-in link is invalid or has expired. Request a new secure link.",
  auth_required: "Sign in to continue to that protected workspace.",
  permission_denied: "Your current organization membership does not permit access to that workspace.",
  auth_unavailable: "Authentication is temporarily unavailable. Try again shortly.",
  sign_out_failed: "We could not confirm sign-out. Close this browser window or try signing out again.",
};

export function authErrorMessage(code?: string) {
  return code ? authErrorMessages[code] ?? "Authentication could not be completed. Try again." : undefined;
}
