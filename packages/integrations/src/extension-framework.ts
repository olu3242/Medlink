export type ExtensionPoint =
  | "ai_provider" | "notification_provider" | "payment_provider"
  | "identity_provider" | "pharmacy_integration" | "hospital_integration"
  | "analytics_module";

export interface PlatformExtension {
  readonly id: string;
  readonly point: ExtensionPoint;
  readonly version: string;
  readonly contractVersion: string;
  readonly ownerId: string;
  readonly tenantScoped: boolean;
  health(): Promise<boolean>;
}

export interface ExtensionRegistration {
  readonly extension: PlatformExtension;
  readonly certificationEvidenceSha256: string;
  readonly enabledTenants: readonly string[];
}

export class ExtensionRegistry {
  private readonly registrations = new Map<string, ExtensionRegistration>();

  register(registration: ExtensionRegistration): void {
    const { extension } = registration;
    if (this.registrations.has(extension.id)) {
      throw new Error("Extension identity is already registered");
    }
    if (!/^\d+\.\d+\.\d+$/.test(extension.version)
      || !/^\d+\.\d+\.\d+$/.test(extension.contractVersion)) {
      throw new Error("Extension and contract versions must use semantic versioning");
    }
    if (!/^[a-f0-9]{64}$/i.test(registration.certificationEvidenceSha256)) {
      throw new Error("Certified extension evidence is required");
    }
    if (!extension.tenantScoped && registration.enabledTenants.length > 0) {
      throw new Error("Global extension cannot declare tenant enablement");
    }
    this.registrations.set(extension.id, registration);
  }

  resolve(point: ExtensionPoint, tenantId: string): readonly PlatformExtension[] {
    return [...this.registrations.values()]
      .filter(({ extension, enabledTenants }) =>
        extension.point === point
        && (!extension.tenantScoped || enabledTenants.includes(tenantId))
      )
      .map(({ extension }) => extension);
  }
}
