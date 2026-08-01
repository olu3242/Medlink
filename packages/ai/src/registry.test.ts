import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "@medlink/runtime";
import { AIGatewayError } from "./errors";
import { PromptRegistry, type PromptDefinition } from "./registry";

const pharmacistContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "pharmacist",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

const summarizePrescription: PromptDefinition = {
  id: "summarize_prescription",
  version: "1.0.0",
  owner: "clinical-ai-team",
  purpose: "Summarize a prescription image's extracted text for pharmacist review",
  allowedRoles: ["pharmacist", "pharmacy_staff"],
  requiredInputs: ["extractedText"],
  template: "Summarize this prescription for a pharmacist: {{extractedText}}",
};

describe("PromptRegistry registration", () => {
  it("registers a well-formed prompt", () => {
    const registry = new PromptRegistry();
    expect(() => registry.register(summarizePrescription)).not.toThrow();
  });

  it("rejects a template referencing an undeclared input", () => {
    const registry = new PromptRegistry();
    expect(() =>
      registry.register({ ...summarizePrescription, template: "Summarize {{extractedText}} for {{patientName}}" }),
    ).toThrow(/undeclared input/);
  });

  it("rejects a declared required input the template never uses", () => {
    const registry = new PromptRegistry();
    expect(() =>
      registry.register({ ...summarizePrescription, requiredInputs: ["extractedText", "patientName"] }),
    ).toThrow(/unused required input/);
  });

  it("rejects re-registering the same id and version", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    expect(() => registry.register(summarizePrescription)).toThrow(/already registered/);
  });
});

describe("PromptRegistry.resolve", () => {
  it("resolves the latest version when none is specified", () => {
    const registry = new PromptRegistry([
      summarizePrescription,
      { ...summarizePrescription, version: "1.1.0" },
    ]);
    expect(registry.resolve("summarize_prescription").version).toBe("1.1.0");
  });

  it("resolves a pinned earlier version", () => {
    const registry = new PromptRegistry([
      summarizePrescription,
      { ...summarizePrescription, version: "1.1.0" },
    ]);
    expect(registry.resolve("summarize_prescription", "1.0.0").version).toBe("1.0.0");
  });

  it("throws prompt_not_found for an unknown id", () => {
    const registry = new PromptRegistry();
    expect(() => registry.resolve("unknown")).toThrow(AIGatewayError);
    try {
      registry.resolve("unknown");
    } catch (error) {
      expect((error as AIGatewayError).code).toBe("prompt_not_found");
    }
  });

  it("throws prompt_version_not_found for an unknown pinned version", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    expect(() => registry.resolve("summarize_prescription", "9.9.9")).toThrow(AIGatewayError);
  });
});

describe("PromptRegistry.rollback", () => {
  it("resolves the declared rollback version", () => {
    const registry = new PromptRegistry([
      summarizePrescription,
      { ...summarizePrescription, version: "1.1.0", rollbackVersion: "1.0.0" },
    ]);
    expect(registry.rollback("summarize_prescription").version).toBe("1.0.0");
  });

  it("throws when no rollbackVersion is declared", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    expect(() => registry.rollback("summarize_prescription")).toThrow(/declares no rollbackVersion/);
  });
});

describe("PromptRegistry.render", () => {
  it("renders a prompt for an allowed role", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    const rendered = registry.render(pharmacistContext, "summarize_prescription", {
      extractedText: "Amoxicillin 500mg TID x7d",
    });
    expect(rendered.text).toBe("Summarize this prescription for a pharmacist: Amoxicillin 500mg TID x7d");
  });

  it("denies a role not on the prompt's allowedRoles", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    const patientContext: RuntimeContext = { ...pharmacistContext, role: "patient" };
    expect(() => registry.render(patientContext, "summarize_prescription", { extractedText: "x" })).toThrow(
      AIGatewayError,
    );
    try {
      registry.render(patientContext, "summarize_prescription", { extractedText: "x" });
    } catch (error) {
      expect((error as AIGatewayError).code).toBe("role_not_permitted");
    }
  });

  it("rejects a call missing a required input", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    expect(() => registry.render(pharmacistContext, "summarize_prescription", {})).toThrow(AIGatewayError);
    try {
      registry.render(pharmacistContext, "summarize_prescription", {});
    } catch (error) {
      expect((error as AIGatewayError).code).toBe("missing_required_input");
    }
  });

  it("rejects a call with an unrecognized input", () => {
    const registry = new PromptRegistry([summarizePrescription]);
    expect(() =>
      registry.render(pharmacistContext, "summarize_prescription", { extractedText: "x", extra: "y" }),
    ).toThrow(AIGatewayError);
  });
});
