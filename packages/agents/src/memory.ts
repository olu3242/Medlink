import { findAgent, type AgentMemoryBoundary } from "./registry";

export interface AgentMemoryRecord {
  readonly organizationId: string;
  readonly agentId: string;
  readonly subjectId: string;
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly expiresAt?: Date;
}

export interface AgentMemoryStore {
  write(record: AgentMemoryRecord): Promise<void>;
  read(
    organizationId: string,
    agentId: string,
    subjectId: string,
    key: string,
  ): Promise<AgentMemoryRecord | null>;
  list(
    organizationId: string,
    agentId: string,
    subjectId: string,
  ): Promise<readonly AgentMemoryRecord[]>;
}

export type MemoryWriteDenialReason =
  | "agent_not_registered"
  | "agent_retired"
  | "memory_disabled_for_agent"
  | "session_memory_requires_expiry";

export interface MemoryWriteDecision {
  readonly allowed: boolean;
  readonly reason?: MemoryWriteDenialReason;
}

interface MemoryBoundaryLookupResult {
  readonly status: "active" | "retired";
  readonly memoryBoundary: AgentMemoryBoundary;
}

// Consults AGL-1's registry for the agent's declared memoryBoundary before
// any write reaches the store. An agent whose memoryBoundary is "none" can
// never acquire a memory row at all; "session" memory must always carry an
// expiry (also enforced independently at the database level by migration
// 202607310001's CHECK constraint -- the same defense-in-depth relationship
// policy.ts documents between its own decision and each canonical RPC's own
// RBAC re-enforcement).
export function authorizeMemoryWrite(
  agentId: string,
  expiresAt: Date | undefined,
  lookup: (id: string) => MemoryBoundaryLookupResult | undefined = findAgent,
): MemoryWriteDecision {
  const agent = lookup(agentId);
  if (!agent) return { allowed: false, reason: "agent_not_registered" };
  if (agent.status !== "active") return { allowed: false, reason: "agent_retired" };
  if (agent.memoryBoundary === "none") {
    return { allowed: false, reason: "memory_disabled_for_agent" };
  }
  if (agent.memoryBoundary === "session" && !expiresAt) {
    return { allowed: false, reason: "session_memory_requires_expiry" };
  }
  return { allowed: true };
}

// The governed write path: nothing reaches an AgentMemoryStore without
// first clearing authorizeMemoryWrite. Returns the (denied) decision
// instead of throwing so a caller can log/branch on the specific reason,
// the same shape authorizeAgentCapability's decision already takes.
export async function writeAgentMemory(
  store: AgentMemoryStore,
  record: AgentMemoryRecord,
): Promise<MemoryWriteDecision> {
  const decision = authorizeMemoryWrite(record.agentId, record.expiresAt);
  if (!decision.allowed) return decision;
  await store.write(record);
  return decision;
}

export class InMemoryAgentMemoryStore implements AgentMemoryStore {
  private readonly records = new Map<string, AgentMemoryRecord>();

  private compositeKey(
    record: Pick<AgentMemoryRecord, "organizationId" | "agentId" | "subjectId" | "key">,
  ): string {
    return [record.organizationId, record.agentId, record.subjectId, record.key].join("::");
  }

  async write(record: AgentMemoryRecord): Promise<void> {
    this.records.set(this.compositeKey(record), record);
  }

  async read(
    organizationId: string,
    agentId: string,
    subjectId: string,
    key: string,
  ): Promise<AgentMemoryRecord | null> {
    return this.records.get(
      this.compositeKey({ organizationId, agentId, subjectId, key }),
    ) ?? null;
  }

  async list(
    organizationId: string,
    agentId: string,
    subjectId: string,
  ): Promise<readonly AgentMemoryRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.organizationId === organizationId &&
        record.agentId === agentId &&
        record.subjectId === subjectId,
    );
  }
}
