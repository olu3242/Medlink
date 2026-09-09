import { describe, expect, it } from "vitest";
import {
  canAccessPortal, canPerformObjectAction, canonicalPersonas, isRouteAllowed,
  navigationForRole, personaContractForRole, projectPersonaFields,
} from "./persona-contracts";

describe("persona convergence contract", () => {
  it("maps every admitted production role without activating deferred personas", () => {
    expect(canonicalPersonas).toContain("PROVIDER");
    expect(personaContractForRole("patient")?.persona).toBe("PATIENT");
    expect(personaContractForRole("pharmacist")?.persona).toBe("PHARMACIST");
    expect(personaContractForRole("pharmacy_staff")?.persona).toBe("PHARMACY_STAFF");
    expect(personaContractForRole("inventory_manager")?.persona).toBe("PHARMACY_STAFF");
    expect(personaContractForRole("pharmacy_owner")?.persona).toBe("PHARMACY_MANAGER");
    expect(personaContractForRole("platform_admin")?.persona).toBe("MEDLINK_ADMIN");
    expect(personaContractForRole("provider")).toBeNull();
  });

  it("uses the same contract for route and navigation decisions", () => {
    expect(canAccessPortal("patient", "patient")).toBe(true);
    expect(canAccessPortal("patient", "admin")).toBe(false);
    expect(canAccessPortal("pharmacist", "pharmacy")).toBe(false);
    expect(isRouteAllowed("pharmacy_staff", "/pharmacy/reservations/123")).toBe(true);
    expect(isRouteAllowed("pharmacy_staff", "/pharmacist/review/123")).toBe(false);
    expect(navigationForRole("patient").map(({ label }) => label)).toEqual([
      "Home", "Medicine Catalog", "Find Medicine", "Reservations", "Prescriptions", "Profile",
    ]);
  });

  it("gives inherited themes an explicit role distinction", () => {
    expect(personaContractForRole("platform_admin")).toMatchObject({ theme: "admin", roleLabel: "Platform Administrator" });
    expect(personaContractForRole("tenant_admin")).toMatchObject({ theme: "admin", roleLabel: "Organization Administrator" });
    expect(personaContractForRole("pharmacy_staff")).toMatchObject({ theme: "pharmacy", roleLabel: "Pharmacy Staff" });
    expect(personaContractForRole("inventory_manager")).toMatchObject({ theme: "pharmacy", roleLabel: "Inventory Manager" });
    expect(personaContractForRole("pharmacy_owner")).toMatchObject({ theme: "pharmacy-manager", roleLabel: "Pharmacy Owner" });
  });

  it("denies cross-persona semantic actions, including admin clinical authority", () => {
    expect(canPerformObjectAction("patient", "Medicine", "READ")).toBe(true);
    expect(canPerformObjectAction("patient", "Prescription", "CREATE")).toBe(true);
    expect(canPerformObjectAction("patient", "Reservation", "CREATE")).toBe(true);
    expect(canPerformObjectAction("patient", "Inventory", "UPDATE")).toBe(false);
    expect(canPerformObjectAction("pharmacist", "Medicine", "RECOMMEND")).toBe(true);
    expect(canPerformObjectAction("pharmacist", "Inventory", "READ")).toBe(true);
    expect(canPerformObjectAction("pharmacist", "Settlement", "SETTLE")).toBe(false);
    expect(canPerformObjectAction("pharmacy_staff", "ClinicalReview", "APPROVE", "pending_review")).toBe(false);
    expect(canPerformObjectAction("pharmacy_owner", "PlatformPolicy", "GOVERN")).toBe(false);
    expect(canPerformObjectAction("pharmacy_owner", "Inventory", "UPDATE")).toBe(true);
    expect(canPerformObjectAction("pharmacy_owner", "OrganizationMembership", "UPDATE")).toBe(true);
    expect(canPerformObjectAction("platform_admin", "Organization", "GOVERN")).toBe(true);
    expect(canPerformObjectAction("platform_admin", "Medicine", "GOVERN")).toBe(true);
    expect(canPerformObjectAction("platform_admin", "AuditEvent", "READ")).toBe(true);
    expect(canPerformObjectAction("platform_admin", "ClinicalReview", "APPROVE", "pending_review")).toBe(false);
  });

  it("enforces workflow state and deny-by-default behavior", () => {
    expect(canPerformObjectAction("pharmacist", "ClinicalReview", "APPROVE", "pending_review")).toBe(true);
    expect(canPerformObjectAction("pharmacist", "ClinicalReview", "APPROVE", "approved")).toBe(false);
    expect(canPerformObjectAction("pharmacy_staff", "Reservation", "EXECUTE", "ready")).toBe(true);
    expect(canPerformObjectAction("pharmacy_staff", "Reservation", "EXECUTE", "collected")).toBe(false);
    expect(canPerformObjectAction("provider", "Inventory", "UPDATE")).toBe(false);
  });

  it("removes sensitive inventory fields instead of cosmetically hiding them", () => {
    const inventory = {
      inventoryId: "inventory-1", medicineName: "Amoxicillin", stockStatus: "available",
      publicPrice: 1200, batchNumber: "B-100", supplier: "Private supplier",
      quantityReserved: 8, costPrice: 600, adjustmentHistory: ["internal"],
    };
    expect(projectPersonaFields("patient", "Inventory", inventory)).toEqual({
      inventoryId: "inventory-1", medicineName: "Amoxicillin", stockStatus: "available", publicPrice: 1200,
    });
    expect(projectPersonaFields("pharmacist", "Inventory", { ...inventory, availableQuantity: 4 })).toEqual({
      batchNumber: "B-100", quantityReserved: 8, availableQuantity: 4,
    });
    expect(projectPersonaFields("pharmacy_owner", "Inventory", inventory)).toMatchObject({
      batchNumber: "B-100", supplier: "Private supplier", costPrice: 600,
    });
    expect(projectPersonaFields("provider", "Inventory", inventory)).toEqual({});
  });
});
