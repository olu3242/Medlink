import { describe, expect, it } from "vitest";
import {
  findAgent,
  findCapability,
  governedAgentCatalog,
  humanExclusiveOperations,
  validateGovernedAgentCatalog,
  type AgentIdentity,
} from "./registry";

describe("governedAgentCatalog", () => {
  it("passes structural validation with zero violations", () => {
    expect(validateGovernedAgentCatalog(governedAgentCatalog)).toEqual([]);
  });

  it("never lets a capability invoke a human-exclusive decision RPC", () => {
    for (const agent of governedAgentCatalog) {
      for (const capability of agent.capabilities) {
        if (capability.invokes) {
          expect(humanExclusiveOperations).not.toContain(capability.invokes);
        }
      }
    }
  });

  it("never marks a capability as an autonomous clinical decision", () => {
    for (const agent of governedAgentCatalog) {
      for (const capability of agent.capabilities) {
        expect(capability.clinicalDecision).toBe(false);
      }
    }
  });

  it("finds a registered agent and capability by id/name", () => {
    expect(findAgent("conversation")?.name).toBe("Conversation Agent");
    expect(findCapability("ocr", "extract_prescription")?.invokes).toBe(
      "record_prescription_extraction",
    );
  });

  it("returns undefined for an unregistered agent or capability", () => {
    expect(findAgent("does-not-exist")).toBeUndefined();
    expect(findCapability("conversation", "does-not-exist")).toBeUndefined();
  });
});

describe("validateGovernedAgentCatalog", () => {
  const validAgent: AgentIdentity = {
    id: "sample",
    name: "Sample Agent",
    mission: "Sample.",
    memoryBoundary: "none",
    status: "active",
    capabilities: [{
      name: "sample_capability",
      description: "Sample.",
      mutatesState: false,
      allowedRoles: ["patient"],
      requiresHumanApproval: false,
      clinicalDecision: false,
    }],
  };

  it("flags a duplicate agent id", () => {
    expect(validateGovernedAgentCatalog([validAgent, validAgent]))
      .toContain("duplicate agent id: sample");
  });

  it("flags a duplicate capability name within one agent", () => {
    const duplicated: AgentIdentity = {
      ...validAgent,
      capabilities: [validAgent.capabilities[0]!, validAgent.capabilities[0]!],
    };
    expect(validateGovernedAgentCatalog([duplicated]))
      .toContain("duplicate capability name: sample.sample_capability");
  });

  it("flags a capability with no allowed roles", () => {
    const noRoles: AgentIdentity = {
      ...validAgent,
      capabilities: [{ ...validAgent.capabilities[0]!, allowedRoles: [] }],
    };
    expect(validateGovernedAgentCatalog([noRoles]))
      .toContain("capability declares no allowed roles: sample.sample_capability");
  });

  it("flags a mutating capability with no canonical operation declared", () => {
    const missingInvokes: AgentIdentity = {
      ...validAgent,
      capabilities: [{ ...validAgent.capabilities[0]!, mutatesState: true }],
    };
    expect(validateGovernedAgentCatalog([missingInvokes]))
      .toContain("mutating capability declares no canonical operation: sample.sample_capability");
  });

  it("flags a read-only capability that declares a canonical operation", () => {
    const spuriousInvokes: AgentIdentity = {
      ...validAgent,
      capabilities: [{
        ...validAgent.capabilities[0]!,
        mutatesState: false,
        invokes: "search_catalog",
      }],
    };
    expect(validateGovernedAgentCatalog([spuriousInvokes]))
      .toContain("read-only capability declares a canonical operation: sample.sample_capability");
  });

  it("flags a capability that invokes a human-exclusive operation", () => {
    // CanonicalOperation's closed union already refuses this at compile
    // time for a literal catalog entry -- the cast simulates a catalog
    // assembled dynamically (e.g. loaded from config), which is exactly
    // what this runtime guard exists to defend, not just the literal case
    // the type system already blocks.
    const bypass = {
      ...validAgent,
      capabilities: [{
        ...validAgent.capabilities[0]!,
        mutatesState: true,
        invokes: "decide_clinical_review",
      }],
    } as unknown as AgentIdentity;
    expect(validateGovernedAgentCatalog([bypass])).toContain(
      "capability invokes a human-exclusive operation: sample.sample_capability -> decide_clinical_review",
    );
  });

  it("flags a clinical-decision capability that does not require human approval", () => {
    const unsupervised: AgentIdentity = {
      ...validAgent,
      capabilities: [{
        ...validAgent.capabilities[0]!,
        clinicalDecision: true,
        requiresHumanApproval: false,
      }],
    };
    expect(validateGovernedAgentCatalog([unsupervised])).toContain(
      "clinical-decision capability does not require human approval: sample.sample_capability",
    );
  });
});
