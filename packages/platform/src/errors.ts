import type { Permission, Role } from "./roles";

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends PlatformError {
  constructor(message = "Authentication is required") {
    super(message, "authentication_required", 401);
  }
}

export class TenantContextError extends PlatformError {
  constructor(message = "No active tenant context is available") {
    super(message, "tenant_context_required", 403);
  }
}

export class AuthorizationError extends PlatformError {
  constructor(role: Role, permission: Permission) {
    super(
      `Role '${role}' does not have permission '${permission}'`,
      "permission_denied",
      403,
    );
  }
}
