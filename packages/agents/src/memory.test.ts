import { describe, expect, it } from "vitest";
import {
  authorizeMemoryWrite,
  InMemoryAgentMemoryStore,
  writeAgentMemory,
  type AgentMemoryRecord,
} from "./memory";

describe("authorizeMemoryWrite", () => {
  it("denies an unregistered agent", () => {
    expect(authorizeMemoryWrite("ghost", undefined))
      .toEqual({ allowed: false, reason: "agent_not_registered" });
  });

  it("denies a retired agent", () => {
    const lookup = () => ({ status: "retired" as const, memoryBoundary: "session" as const });
    expect(authorizeMemoryWrite("retired-agent", new Date(), lookup))
      .toEqual({ allowed: false, reason: "agent_retired" });
  });

  it("denies memory for an agent whose boundary is none", () => {
    // ocr's real registry entry declares memoryBoundary "none".
    expect(authorizeMemoryWrite("ocr", undefined))
      .toEqual({ allowed: false, reason: "memory_disabled_for_agent" });
  });

  it("denies session memory with no expiry", () => {
    // conversation's real registry entry declares memoryBoundary "session".
    expect(authorizeMemoryWrite("conversation", undefined))
      .toEqual({ allowed: false, reason: "session_memory_requires_expiry" });
  });

  it("allows session memory that carries an expiry", () => {
    expect(authorizeMemoryWrite("conversation", new Date(Date.now() + 60_000)))
      .toEqual({ allowed: true });
  });

  it("allows tenant-durable memory with no expiry", () => {
    // clinical-review-assistant's real registry entry declares
    // memoryBoundary "tenant-durable".
    expect(authorizeMemoryWrite("clinical-review-assistant", undefined))
      .toEqual({ allowed: true });
  });
});

describe("writeAgentMemory", () => {
  const baseRecord: AgentMemoryRecord = {
    organizationId: "org-1",
    agentId: "conversation",
    subjectId: "patient-1",
    key: "last_intent",
    value: { intent: "medicine_search" },
  };

  it("never reaches the store when the write is denied", async () => {
    const store = new InMemoryAgentMemoryStore();
    const decision = await writeAgentMemory(store, baseRecord);
    expect(decision).toEqual({ allowed: false, reason: "session_memory_requires_expiry" });
    expect(await store.read("org-1", "conversation", "patient-1", "last_intent")).toBeNull();
  });

  it("writes through once authorized", async () => {
    const store = new InMemoryAgentMemoryStore();
    const record = { ...baseRecord, expiresAt: new Date(Date.now() + 60_000) };
    const decision = await writeAgentMemory(store, record);
    expect(decision).toEqual({ allowed: true });
    expect(await store.read("org-1", "conversation", "patient-1", "last_intent"))
      .toEqual(record);
  });
});

describe("InMemoryAgentMemoryStore", () => {
  it("scopes list() by organization, agent, and subject", async () => {
    const store = new InMemoryAgentMemoryStore();
    await store.write({
      organizationId: "org-1",
      agentId: "clinical-review-assistant",
      subjectId: "patient-1",
      key: "last_findings",
      value: { count: 2 },
    });
    await store.write({
      organizationId: "org-1",
      agentId: "clinical-review-assistant",
      subjectId: "patient-2",
      key: "last_findings",
      value: { count: 0 },
    });
    await store.write({
      organizationId: "org-2",
      agentId: "clinical-review-assistant",
      subjectId: "patient-1",
      key: "last_findings",
      value: { count: 9 },
    });

    const results = await store.list("org-1", "clinical-review-assistant", "patient-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.value).toEqual({ count: 2 });
  });

  it("overwrites the same composite key rather than duplicating", async () => {
    const store = new InMemoryAgentMemoryStore();
    const record = {
      organizationId: "org-1",
      agentId: "conversation",
      subjectId: "patient-1",
      key: "last_intent",
      value: { intent: "a" },
    };
    await store.write(record);
    await store.write({ ...record, value: { intent: "b" } });
    const results = await store.list("org-1", "conversation", "patient-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.value).toEqual({ intent: "b" });
  });
});
