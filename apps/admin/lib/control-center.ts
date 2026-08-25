import type { SupabaseClient } from "@supabase/supabase-js";
import { activeWorkQueue, createDashboardAuthorizationContext, serializeAuthorizedFields, type DashboardFilters, type Role } from "@medlink/platform";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";

type Section = "platform" | "organizations" | "catalog" | "pharmacies" | "inventory" | "security";
type Status = "healthy" | "attention" | "empty" | "unknown";

async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const result = await query;
  if (result.error) throw new RuntimeError("infrastructure", "dashboard_query_failed", "Dashboard data could not be loaded", 503, true, undefined, { cause: result.error });
  return result.count ?? 0;
}

function metric(id: string, label: string, value: number, href: string, status: Status = "healthy") {
  return { id, label, value, status, href };
}

export class ControlCenterService {
  constructor(private readonly database: SupabaseClient) {}

  async load(section: Section, runtime: RuntimeContext, filters: DashboardFilters = {}) {
    const authorization = createDashboardAuthorizationContext({
      userId: runtime.userId, role: runtime.role as Role,
      organizationId: runtime.organizationId, tenantId: runtime.tenantId,
    });
    if (authorization.role === "patient" || authorization.role === "provider") {
      throw new RuntimeError("authorization", "control_center_denied", "Control Center access is not permitted", 403);
    }
    if ((section === "platform" || section === "security") && authorization.role !== "platform_admin") {
      throw new RuntimeError("authorization", "platform_dashboard_denied", "Platform dashboard access is not permitted", 403);
    }
    await this.validateFilters(authorization.role, authorization.organizationId, filters);
    const generatedAt = new Date().toISOString();
    const data = section === "platform" ? await this.platform()
      : section === "organizations" ? await this.organizations(authorization.role, authorization.organizationId, filters)
      : section === "catalog" ? await this.catalog()
      : section === "pharmacies" ? await this.pharmacies(authorization.role, authorization.organizationId, filters)
      : section === "inventory" ? await this.inventory(authorization.role, authorization.organizationId, filters)
      : this.security();
    return { section, authorization, generatedAt, ...data };
  }

  private async validateFilters(role: Role, organizationId: string, filters: DashboardFilters) {
    if (role !== "platform_admin" && filters.organizationId && filters.organizationId !== organizationId) {
      throw new RuntimeError("authorization", "dashboard_filter_tenant_denied", "The organization filter is outside the authorized tenant", 403);
    }
    if (role !== "platform_admin" && filters.pharmacyId && filters.pharmacyId !== organizationId) {
      throw new RuntimeError("authorization", "dashboard_filter_pharmacy_denied", "The pharmacy filter is outside the authorized tenant", 403);
    }
    if (filters.organizationId && filters.pharmacyId && filters.organizationId !== filters.pharmacyId) {
      throw new RuntimeError("validation", "dashboard_filter_dependency_invalid", "The pharmacy does not belong to the selected organization", 400);
    }
    if (filters.locationId) {
      const expectedOrganization = filters.pharmacyId ?? filters.organizationId ?? organizationId;
      const { data, error } = await this.database.from("pharmacy_locations").select("id").eq("id", filters.locationId).eq("organization_id", expectedOrganization).is("deleted_at", null).maybeSingle();
      if (error || !data) throw new RuntimeError("authorization", "dashboard_filter_location_denied", "The location is outside the authorized pharmacy", 403);
    }
  }

  private async platform() {
    const [organizations, memberships, medicines, activeMedicines, locations, catalogItems, mappings, batches, reservations] = await Promise.all([
      count(this.database.from("organizations").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("organization_memberships").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).eq("status", "active").is("deleted_at", null)),
      count(this.database.from("pharmacy_locations").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("pharmacy_catalog_items").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("pharmacy_catalog_mappings").select("id", { count: "exact", head: true }).eq("is_current", true)),
      count(this.database.from("inventory_batches").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("reservations").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    ]);
    return { metrics: [
      metric("organizations", "Organizations", organizations, "/control-center/organizations"),
      metric("memberships", "Active memberships", memberships, "/control-center/organizations"),
      metric("medicines", "Medicines", medicines, "/control-center/catalog"),
      metric("active-medicines", "Active medicines", activeMedicines, "/control-center/catalog"),
      metric("locations", "Pharmacy locations", locations, "/control-center/pharmacies"),
      metric("catalog-items", "Pharmacy catalog items", catalogItems, "/control-center/pharmacies", catalogItems ? "healthy" : "empty"),
      metric("mappings", "Canonical mappings", mappings, "/control-center/pharmacies", mappings ? "healthy" : "empty"),
      metric("inventory", "Inventory batches", batches, "/control-center/inventory", batches ? "healthy" : "empty"),
      metric("reservations", "Reservations", reservations, "/control-center/reservations", reservations ? "healthy" : "empty"),
    ], workQueue: activeWorkQueue([{ id: "mapping-required", active: mappings === 0, severity: "warning", title: "Mapping required", reason: "No pharmacy catalog mappings onboarded yet.", href: "/control-center/pharmacies" }]) };
  }

  private async organizations(role: Role, organizationId: string, filters: DashboardFilters) {
    let organizations = this.database.from("organizations").select("id,name,type,created_at").is("deleted_at", null).order("name").limit(100);
    if (role !== "platform_admin") organizations = organizations.eq("id", organizationId);
    else if (filters.organizationId) organizations = organizations.eq("id", filters.organizationId);
    const { data, error } = await organizations;
    if (error) throw new RuntimeError("infrastructure", "dashboard_query_failed", "Organizations could not be loaded", 503, true, undefined, { cause: error });
    return { organizations: data ?? [] };
  }

  private async catalog() {
    const registrationRows = this.database.from("medicine_registrations").select("medicine_id,medicines!inner(status,deleted_at)").eq("authority_code", "NAFDAC").eq("medicines.status", "active").is("medicines.deleted_at", null).is("deleted_at", null).limit(10_000);
    const [medicines, active, draft, ingredients, manufacturers, registrations, expiredRegistrations, manufacturerPresent, augmentin, registrationResult] = await Promise.all([
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).eq("status", "active").is("deleted_at", null)),
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).eq("status", "draft").is("deleted_at", null)),
      count(this.database.from("active_ingredients").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("merdp_manufacturer_identities").select("id", { count: "exact", head: true })),
      count(this.database.from("medicine_registrations").select("id", { count: "exact", head: true }).is("deleted_at", null)),
      count(this.database.from("medicine_registrations").select("id", { count: "exact", head: true }).lt("valid_until", new Date().toISOString().slice(0, 10)).is("deleted_at", null)),
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).eq("status", "active").not("manufacturer_name", "is", null).neq("manufacturer_name", "").is("deleted_at", null)),
      count(this.database.from("medicines").select("id", { count: "exact", head: true }).ilike("brand_name", "%Augmentin%").is("deleted_at", null)),
      registrationRows,
    ]);
    if (registrationResult.error) throw new RuntimeError("infrastructure", "dashboard_query_failed", "Registration coverage could not be loaded", 503, true, undefined, { cause: registrationResult.error });
    const nafdacPresent = new Set((registrationResult.data ?? []).map((row) => row.medicine_id)).size;
    const percent = (present: number, total: number) => total === 0 ? 0 : Math.round((present / total) * 10_000) / 100;
    return {
      metrics: [metric("medicines", "Medicines", medicines, "/catalog"), metric("active", "Active medicines", active, "/catalog?status=active"), metric("draft", "Draft medicines", draft, "/catalog?status=draft"), metric("ingredients", "Active ingredients", ingredients, "/control-center/catalog"), metric("manufacturers", "Manufacturers", manufacturers, "/control-center/catalog"), metric("registrations", "Registrations", registrations, "/control-center/catalog"), metric("expired-registrations", "Expired registrations", expiredRegistrations, "/control-center/catalog?registration=expired", expiredRegistrations ? "attention" : "healthy"), metric("augmentin", "Augmentin products", augmentin, "/catalog?q=Augmentin", augmentin ? "healthy" : "attention")],
      manufacturerCoverage: { total: active, present: manufacturerPresent, missing: Math.max(0, active - manufacturerPresent), percent: percent(manufacturerPresent, active) },
      nafdacCoverage: { total: active, present: nafdacPresent, missing: Math.max(0, active - nafdacPresent), percent: percent(nafdacPresent, active) },
    };
  }

  private async pharmacies(role: Role, organizationId: string, filters: DashboardFilters) {
    const scoped = role !== "platform_admin";
    const selectedOrganization = filters.pharmacyId ?? filters.organizationId ?? organizationId;
    const locationQuery = this.database.from("pharmacy_locations").select("id", { count: "exact", head: true }).is("deleted_at", null);
    const activeQuery = this.database.from("pharmacy_locations").select("id", { count: "exact", head: true }).eq("is_active", true).is("deleted_at", null);
    const itemsQuery = this.database.from("pharmacy_catalog_items").select("id", { count: "exact", head: true }).is("deleted_at", null);
    const mappingsQuery = this.database.from("pharmacy_catalog_mappings").select("id", { count: "exact", head: true }).eq("is_current", true);
    const filterScope = scoped || filters.pharmacyId || filters.organizationId;
    const [locations, activeLocations, items, mappings] = await Promise.all([count(filterScope ? locationQuery.eq("organization_id", selectedOrganization) : locationQuery), count(filterScope ? activeQuery.eq("organization_id", selectedOrganization) : activeQuery), count(filterScope ? itemsQuery.eq("organization_id", selectedOrganization) : itemsQuery), count(filterScope ? mappingsQuery.eq("organization_id", selectedOrganization) : mappingsQuery)]);
    return { metrics: [metric("locations", "Locations", locations, "/control-center/pharmacies"), metric("active-locations", "Active locations", activeLocations, "/control-center/pharmacies?status=active"), metric("catalog-items", "Catalog items", items, "/control-center/pharmacies"), metric("mappings", "Mappings", mappings, "/control-center/pharmacies", mappings ? "healthy" : "empty")], emptyState: mappings === 0 ? "No pharmacy catalog mappings onboarded yet." : null };
  }

  private async inventory(role: Role, organizationId: string, filters: DashboardFilters) {
    const base = () => this.database.from("inventory_batches").select("id", { count: "exact", head: true }).is("deleted_at", null);
    const selectedOrganization = filters.pharmacyId ?? filters.organizationId ?? organizationId;
    const scoped = (query: ReturnType<typeof base>) => role === "platform_admin" && !filters.pharmacyId && !filters.organizationId ? query : query.eq("organization_id", selectedOrganization);
    const [batches, sellable, zero, expired] = await Promise.all([count(scoped(base())), count(scoped(base()).eq("status", "available").gt("available_quantity", 0).gt("expires_on", new Date().toISOString().slice(0, 10))), count(scoped(base()).lte("available_quantity", 0)), count(scoped(base()).lt("expires_on", new Date().toISOString().slice(0, 10)))]);
    return { metrics: [metric("batches", "Batches", batches, "/control-center/inventory"), metric("sellable", "Sellable batches", sellable, "/control-center/inventory?status=sellable"), metric("zero", "Zero quantity", zero, "/control-center/inventory?status=empty", zero ? "attention" : "healthy"), metric("expired", "Expired", expired, "/control-center/inventory?status=expired", expired ? "attention" : "healthy")], priceAccess: serializeAuthorizedFields({ priceAuthority: "inventory_batches", unitPrice: "restricted" }, { priceAuthority: "read_only", unitPrice: "hidden" }) };
  }

  private security() {
    return { metrics: ["migrationParity", "securityTests", "providerConformance", "deploymentContract", "tenantIsolation", "fixtureRpcSecurity", "catalogRls"].map((id) => ({ id, status: "unknown" as const, value: null, freshness: null })) };
  }
}
