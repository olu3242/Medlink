import { describe, expect, it } from "vitest";
import { experienceOperationContracts, runtimeServiceContracts } from "./experience-contracts";
import { eventContracts } from "./events";
import { permissions } from "@medlink/platform";
import { normalizeExperiencePath, runExperienceApi } from "./index";
import { z } from "zod";

describe("experience integration registry", () => {
  it("references registered services, permissions, and events", () => {
    const services = new Set(runtimeServiceContracts.map(({ id }) => id));
    const events = new Set(eventContracts.map(({ type }) => type));
    for (const contract of experienceOperationContracts) {
      expect(permissions).toContain(contract.permission);
      expect(contract.services.every((service) => services.has(service))).toBe(true);
      expect(contract.events.every((event) => events.has(event))).toBe(true);
      expect(contract.roles.length).toBeGreaterThan(0);
    }
  });

  it("does not certify missing operations as available", () => {
    expect(experienceOperationContracts.filter(({ status }) => status === "missing").map(({ id }) => id)).toEqual(["communication.conversation"]);
  });

  it("fails closed when a route does not match its experience contract", async () => {
    const response = await runExperienceApi(
      new Request("https://medlink.test/api/v1/mar", { method: "POST" }),
      "patient.mar.list",
      { name: "mar.list", permission: "mar:read", schema: z.object({}), input: async () => ({}), execute: async () => [] },
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "experience_contract_mismatch" });
  });

  it("matches canonical contracts after a persona-app rewrite preserves its prefix", () => {
    expect(normalizeExperiencePath("/patient/api/v1/mar", "patient"))
      .toBe("/api/v1/mar");
    expect(normalizeExperiencePath("/pharmacist/api/v1/review/review-id", "pharmacist"))
      .toBe("/api/v1/review/review-id");
    expect(normalizeExperiencePath("/patient/api/v1/mar", "pharmacist"))
      .toBe("/patient/api/v1/mar");
  });

  it("rejects an unimplemented experience contract before authentication", async () => {
    const response = await runExperienceApi(
      new Request("https://medlink.test/api/v1/conversations"),
      "communication.conversation",
      { name: "conversation.list", permission: "mar:read", schema: z.object({}), input: async () => ({}), execute: async () => [] },
    );
    expect(response.status).toBe(501);
  });
});
