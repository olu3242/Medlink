import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { authorizeAgentCapability, authorizeAgentTask } from "./policy";
import type { AgentIdentity } from "./registry";

const baseContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-0000-0000-000000000001",
  organizationId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  role: "patient",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

const testCatalog: readonly AgentIdentity[] = [
  {
    id: "retired-agent",
    name: "Retired Agent",
    mission: "No longer in service.",
    memoryBoundary: "none",
    status: "retired",
    capabilities: [{
      name: "anything",
      description: "n/a",
      mutatesState: false,
      allowedRoles: ["patient"],
      requiresHumanApproval: false,
      clinicalDecision: false,
    }],
  },
  {
    id: "active-agent",
    name: "Active Agent",
    mission: "In service.",
    memoryBoundary: "none",
    status: "active",
    capabilities: [
      {
        name: "autonomous_action",
        description: "Runs without human sign-off.",
        mutatesState: false,
        allowedRoles: ["patient"],
        requiresHumanApproval: false,
        clinicalDecision: false,
      },
      {
        name: "gated_action",
        description: "Requires human sign-off even for a permitted role.",
        mutatesState: true,
        invokes: "record_clinical_validation",
        allowedRoles: ["patient"],
        requiresHumanApproval: true,
        clinicalDecision: false,
      },
    ],
  },
];

describe("authorizeAgentCapability", () => {
  it("denies an unregistered agent", () => {
    expect(authorizeAgentCapability(baseContext, "ghost", "anything", testCatalog))
      .toEqual({ allowed: false, reason: "agent_not_registered" });
  });

  it("denies a retired agent", () => {
    expect(authorizeAgentCapability(baseContext, "retired-agent", "anything", testCatalog))
      .toEqual({ allowed: false, reason: "agent_retired" });
  });

  it("denies an undeclared capability", () => {
    expect(authorizeAgentCapability(baseContext, "active-agent", "ghost", testCatalog))
      .toEqual({ allowed: false, reason: "capability_not_declared" });
  });

  it("denies a role not permitted for the capability", () => {
    const context = { ...baseContext, role: "pharmacist" };
    expect(authorizeAgentCapability(context, "active-agent", "autonomous_action", testCatalog))
      .toEqual({ allowed: false, reason: "role_not_permitted" });
  });

  it("denies a human-approval-gated capability even for a permitted role", () => {
    expect(authorizeAgentCapability(baseContext, "active-agent", "gated_action", testCatalog))
      .toEqual({ allowed: false, reason: "requires_human_approval" });
  });

  it("allows an autonomous capability for a permitted role", () => {
    expect(authorizeAgentCapability(baseContext, "active-agent", "autonomous_action", testCatalog))
      .toEqual({ allowed: true });
  });

  it("defaults to the real governed agent catalog when none is supplied", () => {
    const context = { ...baseContext, role: "patient" };
    expect(authorizeAgentCapability(context, "conversation", "route_intent"))
      .toEqual({ allowed: true });
  });
});

describe("authorizeAgentTask", () => {
  it("allows only the declared persona and runtime action for a capability", () => {
    expect(authorizeAgentTask({
      agentId: "reservation-coordinator",
      capabilityName: "reserve_matched_inventory",
      action: "reserve_inventory",
      role: "patient",
    })).toEqual({ allowed: true });

    expect(authorizeAgentTask({
      agentId: "reservation-coordinator",
      capabilityName: "reserve_matched_inventory",
      action: "reserve_inventory",
      role: "pharmacy_staff",
    })).toEqual({ allowed: false, reason: "role_not_permitted" });

    expect(authorizeAgentTask({
      agentId: "reservation-coordinator",
      capabilityName: "reserve_matched_inventory",
      action: "collect_reservation",
      role: "patient",
    })).toEqual({ allowed: false, reason: "action_not_permitted" });
  });

  it("does not map payment or fulfillment authority to any agent capability", () => {
    for (const action of ["create_payment", "mark_ready", "collect_reservation"]) {
      expect(authorizeAgentTask({
        agentId: "conversation",
        capabilityName: "route_intent",
        action,
        role: "patient",
      })).toEqual({ allowed: false, reason: "action_not_permitted" });
    }
  });
});
