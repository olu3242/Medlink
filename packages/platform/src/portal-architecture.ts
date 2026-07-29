export type PortalKind =
  | "pharmacy"
  | "pharmacist"
  | "provider"
  | "administrator"
  | "developer"
  | "patient";

export interface PortalDescriptor {
  readonly kind: PortalKind;
  readonly audience: "professional" | "patient";
  readonly requiredForRc1: boolean;
  readonly primaryChannel: "web" | "conversation";
}

export const portalArchitecture: readonly PortalDescriptor[] = [
  { kind: "pharmacy", audience: "professional", requiredForRc1: true, primaryChannel: "web" },
  { kind: "pharmacist", audience: "professional", requiredForRc1: true, primaryChannel: "web" },
  { kind: "provider", audience: "professional", requiredForRc1: true, primaryChannel: "web" },
  { kind: "administrator", audience: "professional", requiredForRc1: true, primaryChannel: "web" },
  { kind: "developer", audience: "professional", requiredForRc1: false, primaryChannel: "web" },
  { kind: "patient", audience: "patient", requiredForRc1: false, primaryChannel: "conversation" },
] as const;

export const requiredPortals = portalArchitecture.filter((portal) => portal.requiredForRc1);
