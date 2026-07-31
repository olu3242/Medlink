import type { RequestContext } from "./request-context";

export type AdministrativeResource =
  | "organization" | "tenant" | "region" | "pharmacy" | "hospital" | "user"
  | "role" | "permission" | "integration" | "subscription" | "billing_plan"
  | "feature_flag" | "api_access" | "certificate" | "environment_setting";

export interface AdministrativeChange {
  readonly id: string;
  readonly tenantId: string;
  readonly resource: AdministrativeResource;
  readonly resourceId: string;
  readonly operation: "create" | "update" | "disable" | "rotate";
  readonly changes: Readonly<Record<string, unknown>>;
  readonly approvalEvidenceSha256?: string;
}

export interface AdministrationAuditSink {
  append(event: {
    readonly changeId: string;
    readonly tenantId: string;
    readonly actorId: string;
    readonly resource: AdministrativeResource;
    readonly resourceId: string;
    readonly operation: AdministrativeChange["operation"];
    readonly occurredAt: Date;
  }): Promise<void>;
}

const privilegedResources: ReadonlySet<AdministrativeResource> = new Set([
  "role", "permission", "api_access", "certificate", "environment_setting",
]);

export class EnterpriseAdministrationService {
  constructor(
    private readonly audit: AdministrationAuditSink,
    private readonly now: () => Date,
  ) {}

  async apply(context: RequestContext, change: AdministrativeChange): Promise<void> {
    if (context.role !== "platform_admin" && context.role !== "tenant_admin") {
      throw new Error("Administrative role required");
    }
    if (context.role !== "platform_admin" && context.tenantId !== change.tenantId) {
      throw new Error("Cross-tenant administration denied");
    }
    if (privilegedResources.has(change.resource)
      && !/^[a-f0-9]{64}$/i.test(change.approvalEvidenceSha256 ?? "")) {
      throw new Error("Privileged administrative approval evidence required");
    }
    if (Object.keys(change.changes).length === 0) {
      throw new Error("Administrative change cannot be empty");
    }
    await this.audit.append({
      changeId: change.id,
      tenantId: change.tenantId,
      actorId: context.userId,
      resource: change.resource,
      resourceId: change.resourceId,
      operation: change.operation,
      occurredAt: this.now(),
    });
  }
}
