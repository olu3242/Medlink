import type { WorkflowInvocationResult, WorkflowInvoker } from "@medlink/conversation";
import { describe, expect, it } from "vitest";
import {
  coordinatedWorkflowInvoker,
  deriveHandoffs,
  InMemoryCoordinationLog,
  recordPlanHandoffs,
} from "./coordination";
import { buildAgentPlan } from "./planning";

describe("deriveHandoffs", () => {
  it("emits exactly one entry handoff for a single-agent plan", () => {
    const { plan } = buildAgentPlan("WF-005", [
      { agentId: "conversation", capabilityName: "route_intent", execute: async () => undefined },
    ]);
    expect(deriveHandoffs(plan!)).toEqual([{
      workflowType: "WF-005",
      atStep: "conversation.route_intent",
      fromAgentId: null,
      toAgentId: "conversation",
      requiresHumanApproval: false,
    }]);
  });

  it("does not duplicate a handoff across consecutive steps by the same agent", () => {
    const { plan } = buildAgentPlan("WF-005", [
      { agentId: "conversation", capabilityName: "route_intent", execute: async () => undefined },
      { agentId: "medicine-match", capabilityName: "search_medicine", execute: async () => undefined },
      { agentId: "medicine-match", capabilityName: "search_medicine", execute: async () => undefined },
    ]);
    const events = deriveHandoffs(plan!);
    expect(events.map((event) => event.toAgentId)).toEqual(["conversation", "medicine-match"]);
    expect(events[1]).toMatchObject({ fromAgentId: "conversation", toAgentId: "medicine-match" });
  });

  it("flags a handoff into a human-approval-gated capability", () => {
    const { plan } = buildAgentPlan("WF-007", [
      { agentId: "conversation", capabilityName: "route_intent", execute: async () => undefined },
      {
        agentId: "clinical-review-assistant",
        capabilityName: "flag_validation_findings",
        execute: async () => undefined,
      },
    ]);
    const events = deriveHandoffs(plan!);
    expect(events[1]).toMatchObject({
      toAgentId: "clinical-review-assistant",
      requiresHumanApproval: true,
    });
  });
});

describe("recordPlanHandoffs", () => {
  it("writes every derived handoff to the log, in order, before the plan runs", async () => {
    const { plan } = buildAgentPlan("WF-005", [
      { agentId: "conversation", capabilityName: "route_intent", execute: async () => undefined },
      { agentId: "medicine-match", capabilityName: "search_medicine", execute: async () => undefined },
    ]);
    const log = new InMemoryCoordinationLog();

    const returned = await recordPlanHandoffs(log, plan!);

    const stored = await log.listByWorkflowType("WF-005");
    expect(stored).toEqual(returned);
    expect(stored.map((event) => event.toAgentId)).toEqual(["conversation", "medicine-match"]);
  });
});

describe("coordinatedWorkflowInvoker", () => {
  class RecordingInvoker implements WorkflowInvoker {
    readonly seenInputs: unknown[] = [];
    async invoke(input: {
      readonly organizationId: string;
      readonly conversationId: string;
      readonly workflowType: string;
      readonly idempotencyKey: string;
      readonly context: Readonly<Record<string, unknown>>;
    }): Promise<WorkflowInvocationResult> {
      this.seenInputs.push(input);
      return { workflowInstanceId: "instance-1", status: "completed" };
    }
  }

  it("logs the handoff before delegating, and returns the underlying result unmodified", async () => {
    const inner = new RecordingInvoker();
    const log = new InMemoryCoordinationLog();
    const invoker = coordinatedWorkflowInvoker(inner, log, "conversation", "workflow-orchestrator");

    const result = await invoker.invoke({
      organizationId: "org-1",
      conversationId: "conversation-1",
      workflowType: "medicine_search",
      idempotencyKey: "key-1",
      context: {},
    });

    expect(result).toEqual({ workflowInstanceId: "instance-1", status: "completed" });
    expect(inner.seenInputs).toHaveLength(1);

    const stored = await log.listByWorkflowType("medicine_search");
    expect(stored).toEqual([{
      workflowType: "medicine_search",
      atStep: "workflow_invocation",
      fromAgentId: "conversation",
      toAgentId: "workflow-orchestrator",
      requiresHumanApproval: false,
    }]);
  });
});
