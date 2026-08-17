import { describe, expect, it, vi } from "vitest";
import { AgentPolicyDeniedError, AgentTaskExecutor } from "./executor";
import { MvpAgentPolicy } from "./policy";

function task(action: string, execute = vi.fn(async () => ({ text: "ok" }))) {
  return {
    id: "task-1",
    engine: "ML-ENG-006",
    capability: "ML-CAP-006",
    action,
    actor: "patient-1",
    tenantId: "tenant-1",
    correlationId: "correlation-1",
    agentId: "prescription-reader",
    agentVersion: "1.0.0",
    persona: "patient",
    context: { tenantId: "tenant-1", patientId: "patient-1" },
    input: {},
    execute,
  };
}

describe("MVP agent runtime contract", () => {
  it("executes an allowed deterministic task and emits telemetry", async () => {
    const record = vi.fn();
    const execute = vi.fn(async () => ({ text: "clean" }));
    const result = await new AgentTaskExecutor(
      new MvpAgentPolicy(),
      { record },
      () => 10,
    ).execute(task("file_scan", execute));

    expect(result).toEqual({ status: "completed", output: { text: "clean" } });
    expect(execute).toHaveBeenCalledOnce();
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: "task-1",
      status: "completed",
      capability: "ML-CAP-006",
    }));
  });

  it("returns one standardized pharmacist approval without executing", async () => {
    const execute = vi.fn(async () => ({}));
    const result = await new AgentTaskExecutor(
      new MvpAgentPolicy(),
      { record: vi.fn() },
    ).execute(task("generic_substitution", execute));

    expect(result).toMatchObject({
      status: "pending_human_review",
      approver: "pharmacist",
      taskId: "task-1",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks unapproved and cross-tenant actions", async () => {
    const executor = new AgentTaskExecutor(
      new MvpAgentPolicy(),
      { record: vi.fn() },
    );

    await expect(executor.execute(task("autonomous_diagnosis")))
      .rejects.toBeInstanceOf(AgentPolicyDeniedError);
    await expect(executor.execute({
      ...task("ocr"),
      context: { tenantId: "tenant-2" },
    })).rejects.toBeInstanceOf(AgentPolicyDeniedError);
  });

  it("binds a registered agent to its declared capability, persona, and action", async () => {
    const executor = new AgentTaskExecutor(
      new MvpAgentPolicy(),
      { record: vi.fn() },
    );
    const execute = vi.fn(async () => ({
      text: "reserved",
      reservationId: "reservation-1",
    }));
    const governed = {
      ...task("reserve_inventory", execute),
      agentId: "reservation-coordinator",
      capability: "reserve_matched_inventory",
    };

    await expect(executor.execute(governed)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(executor.execute({ ...governed, persona: "pharmacy_staff" }))
      .rejects.toBeInstanceOf(AgentPolicyDeniedError);
    await expect(executor.execute({ ...governed, action: "collect_reservation" }))
      .rejects.toBeInstanceOf(AgentPolicyDeniedError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps payment and fulfillment outside Agent/AI authority", async () => {
    const executor = new AgentTaskExecutor(
      new MvpAgentPolicy(),
      { record: vi.fn() },
    );
    for (const action of ["create_payment", "mark_ready", "collect_reservation"]) {
      await expect(executor.execute({
        ...task(action),
        agentId: "conversation",
        capability: "route_intent",
      })).rejects.toBeInstanceOf(AgentPolicyDeniedError);
    }
  });
});
