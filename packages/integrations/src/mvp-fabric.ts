export type MvpIntegration =
  | "identity" | "whatsapp" | "storage" | "ai" | "medicine"
  | "inventory" | "reservation" | "notification" | "maps" | "runtime"
  | "monitoring" | "audit" | "agents" | "mcp" | "configuration"
  | "api" | "security" | "testing" | "documentation";

export type IntegrationStatus = "PASS" | "PARTIAL" | "OPEN" | "BLOCKED" | "FAILED";

export interface IntegrationCertification {
  readonly integration: MvpIntegration;
  readonly status: IntegrationStatus;
  readonly evidence: readonly string[];
  readonly blocker?: string;
}

export interface MvpConfiguration {
  readonly apiUrl: string;
  readonly publicApiUrl?: string;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly whatsappAccessToken?: string;
  readonly whatsappPhoneNumberId?: string;
  readonly whatsappAppSecret?: string;
  readonly storageBucket: string;
  readonly mapsProvider: "internal" | "google" | "mapbox";
  readonly mapsApiKey?: string;
  readonly aiProvider: "disabled" | "openai" | "azure-openai";
  readonly aiApiKey?: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function optional(environment: Environment, name: string): string | undefined {
  return environment[name]?.trim() || undefined;
}

function url(value: string, name: string): string {
  try { return new URL(value).toString().replace(/\/$/, ""); }
  catch { throw new Error(`${name} must be an absolute URL`); }
}

export function loadMvpConfiguration(environment: Environment): MvpConfiguration {
  const mapsProvider = optional(environment, "MAPS_PROVIDER") ?? "internal";
  const aiProvider = optional(environment, "AI_PROVIDER") ?? "disabled";
  const logLevel = optional(environment, "LOG_LEVEL") ?? "info";
  if (!(["internal", "google", "mapbox"] as const).includes(mapsProvider as never)) {
    throw new Error("MAPS_PROVIDER is unsupported");
  }
  if (!(["disabled", "openai", "azure-openai"] as const).includes(aiProvider as never)) {
    throw new Error("AI_PROVIDER is unsupported");
  }
  if (!(["debug", "info", "warn", "error"] as const).includes(logLevel as never)) {
    throw new Error("LOG_LEVEL is unsupported");
  }
  const mapsApiKey = optional(environment, "MAPS_API_KEY");
  const aiApiKey = optional(environment, "AI_API_KEY");
  if (mapsProvider !== "internal" && !mapsApiKey) throw new Error("MAPS_API_KEY is required for the selected provider");
  if (aiProvider !== "disabled" && !aiApiKey) throw new Error("AI_API_KEY is required for the selected provider");
  return {
    apiUrl: url(required(environment, "MEDLINK_API_URL"), "MEDLINK_API_URL"),
    ...(optional(environment, "NEXT_PUBLIC_MEDLINK_API_URL")
      ? { publicApiUrl: url(required(environment, "NEXT_PUBLIC_MEDLINK_API_URL"), "NEXT_PUBLIC_MEDLINK_API_URL") }
      : {}),
    supabaseUrl: url(required(environment, "NEXT_PUBLIC_SUPABASE_URL"), "NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: required(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    ...(optional(environment, "WHATSAPP_ACCESS_TOKEN") ? { whatsappAccessToken: required(environment, "WHATSAPP_ACCESS_TOKEN") } : {}),
    ...(optional(environment, "WHATSAPP_PHONE_NUMBER_ID") ? { whatsappPhoneNumberId: required(environment, "WHATSAPP_PHONE_NUMBER_ID") } : {}),
    ...(optional(environment, "WHATSAPP_APP_SECRET") ? { whatsappAppSecret: required(environment, "WHATSAPP_APP_SECRET") } : {}),
    storageBucket: optional(environment, "PRESCRIPTION_STORAGE_BUCKET") ?? "prescriptions",
    mapsProvider: mapsProvider as MvpConfiguration["mapsProvider"],
    ...(mapsApiKey ? { mapsApiKey } : {}),
    aiProvider: aiProvider as MvpConfiguration["aiProvider"],
    ...(aiApiKey ? { aiApiKey } : {}),
    logLevel: logLevel as MvpConfiguration["logLevel"],
  };
}

export const supportedPrescriptionMediaTypes = ["image/jpeg", "image/png", "application/pdf"] as const;

export interface PrivateDocumentStore {
  put(input: { tenantId: string; objectId: string; bytes: Uint8Array; mediaType: string; expiresAt?: Date }): Promise<void>;
  signedReadUrl(input: { tenantId: string; objectId: string; expiresInSeconds: number }): Promise<string>;
  remove(input: { tenantId: string; objectId: string; reason: string }): Promise<void>;
}

export function validatePrescriptionUpload(input: { mediaType: string; size: number }, maxBytes = 10 * 1024 * 1024): void {
  if (!(supportedPrescriptionMediaTypes as readonly string[]).includes(input.mediaType)) throw new Error("Unsupported prescription media type");
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > maxBytes) throw new Error("Invalid prescription upload size");
}

export interface Coordinates { readonly latitude: number; readonly longitude: number }
export interface PharmacyLocation extends Coordinates { readonly pharmacyId: string; readonly tenantId: string; readonly lga: string }

function radians(degrees: number): number { return degrees * Math.PI / 180; }

export function distanceKilometres(a: Coordinates, b: Coordinates): number {
  for (const point of [a, b]) {
    if (point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) throw new Error("Invalid coordinates");
  }
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const value = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function nearbyPharmacies(origin: Coordinates, locations: readonly PharmacyLocation[], tenantId: string, radiusKm: number): readonly (PharmacyLocation & { distanceKm: number })[] {
  if (!(radiusKm > 0)) throw new Error("Search radius must be positive");
  return locations
    .filter(location => location.tenantId === tenantId)
    .map(location => ({ ...location, distanceKm: distanceKilometres(origin, location) }))
    .filter(location => location.distanceKm <= radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm);
}

export type MvpMcpCapability = "medicine.read" | "inventory.read" | "knowledge.read" | "workflow.read" | "notification.send" | "audit.read";
export interface GovernedMcpTool { readonly name: string; readonly capability: MvpMcpCapability; readonly readOnly: boolean }

export class MvpMcpRegistry {
  private readonly tools = new Map<string, GovernedMcpTool>();
  constructor(private readonly approvedCapabilities: ReadonlySet<MvpMcpCapability>) {}
  register(tool: GovernedMcpTool): void {
    if (!this.approvedCapabilities.has(tool.capability)) throw new Error(`MCP capability is not approved: ${tool.capability}`);
    if (this.tools.has(tool.name)) throw new Error(`MCP tool is already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }
  list(): readonly GovernedMcpTool[] { return [...this.tools.values()]; }
}

export interface IntegrationRequestContext {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly apiVersion: "v1";
}

export function assertIntegrationContext(context: IntegrationRequestContext): void {
  for (const [name, value] of Object.entries(context)) if (!value.trim()) throw new Error(`Missing integration context: ${name}`);
  if (context.apiVersion !== "v1") throw new Error("Unsupported API version");
}

export const rc1Certification: readonly IntegrationCertification[] = [
  { integration: "identity", status: "PASS", evidence: ["packages/platform/src/authorization.ts", "packages/platform/src/request-context.ts"] },
  { integration: "whatsapp", status: "PASS", evidence: ["packages/whatsapp/src/journey.ts", "packages/whatsapp/src/adapter.test.ts"] },
  { integration: "storage", status: "PARTIAL", evidence: ["packages/integrations/src/mvp-fabric.ts"], blocker: "Production private bucket policies and retention job require deployment evidence" },
  { integration: "ai", status: "PASS", evidence: ["packages/ai/src/service.ts", "packages/ai/src/service.test.ts"] },
  { integration: "medicine", status: "PASS", evidence: ["packages/medicine/src/catalog-service.ts", "packages/search/src/service.ts"] },
  { integration: "inventory", status: "PASS", evidence: ["packages/inventory/src/service.ts", "packages/inventory/src/service.test.ts"] },
  { integration: "reservation", status: "PASS", evidence: ["packages/reservations/src/service.ts", "supabase/migrations/202607280008_atomic_reservation.sql"] },
  { integration: "notification", status: "PASS", evidence: ["packages/notifications/src/service.ts", "packages/notifications/src/service.test.ts"] },
  { integration: "maps", status: "PARTIAL", evidence: ["packages/integrations/src/mvp-fabric.ts"], blocker: "External geocoding is optional and requires a configured provider" },
  { integration: "runtime", status: "PASS", evidence: ["packages/runtime/src/transaction.ts", "supabase/migrations/202607270006_transactional_runtime.sql"] },
  { integration: "monitoring", status: "PASS", evidence: ["packages/runtime/src/metrics", "packages/runtime/src/tracing"] },
  { integration: "audit", status: "PASS", evidence: ["supabase/migrations/202607280007_runtime_evidence_repository.sql", "packages/runtime/src/certification"] },
  { integration: "agents", status: "PASS", evidence: ["packages/ai/src/service.ts"] },
  { integration: "mcp", status: "PARTIAL", evidence: ["packages/integrations/src/mvp-fabric.ts"], blocker: "Capability contracts are prepared; no public MCP endpoint is enabled for RC1" },
  { integration: "configuration", status: "PASS", evidence: [".env.example", "packages/integrations/src/mvp-fabric.ts"] },
  { integration: "api", status: "PASS", evidence: ["packages/api/src/experience-contracts.ts", "apps/patient/app/api/v1"] },
  { integration: "security", status: "PASS", evidence: ["packages/security/src/service.ts", "docs/security/THREAT_MODEL.md"] },
  { integration: "testing", status: "PASS", evidence: ["vitest.config.ts", "packages/integrations/src/mvp-fabric.test.ts"] },
  { integration: "documentation", status: "PASS", evidence: ["docs/mvp-integration"] },
] as const;

export const rc2ExcludedIntegrations = [
  "hospital-emr-ehr", "payments", "insurance", "courier-logistics", "laboratory",
  "sms-ussd", "national-pharmacy-exchange", "public-health-reporting",
  "cross-organizational-federation", "autonomous-agent-learning", "extension-marketplace",
] as const;
