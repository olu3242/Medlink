import type { WorkflowInstance, WorkflowStep } from "./service";

export interface CreateMarInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly patientId: string;
  readonly medicineId: string;
  readonly prescriptionId: string | null;
  readonly notes: string | null;
  readonly idempotencyKey: string;
}

export interface CreatedMar {
  readonly id: string;
  readonly state: string;
}

// packages/workflows stays free of any Supabase/app dependency (unlike
// medicine-search.ts and clinical-review.ts, which wrap real domain
// packages, WF-006 has no portable domain package to wrap -- MAR creation
// lives directly against the database via the atomic create_mar RPC,
// migration 202607290016). A concrete implementation of this port belongs
// in the consuming app, the same "adapter lives in the app" split every
// other Supabase-backed adapter this session uses.
export interface MarCreator {
  createMar(input: CreateMarInput): Promise<CreatedMar>;
}

function isCreateMarInput(value: unknown): value is CreateMarInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.organizationId === "string" &&
    typeof candidate.actorId === "string" &&
    typeof candidate.patientId === "string" &&
    typeof candidate.medicineId === "string" &&
    (candidate.prescriptionId === null || typeof candidate.prescriptionId === "string") &&
    (candidate.notes === null || typeof candidate.notes === "string") &&
    typeof candidate.idempotencyKey === "string"
  );
}

// WF-006 Medication Access Request's real, executable "create_mar" step --
// the third canonical workflow definition in packages/workflows backed by
// an actual call rather than just a name (see medicine-search.ts and
// clinical-review.ts for the first two). Reads `createMarInput` from the
// workflow instance's context; a missing or malformed input skips creation
// and reports why, the same pattern clinical-review.ts's runtime type
// guard already established, rather than passing bad data to the RPC or
// throwing.
export function createMarCreationStep(creator: MarCreator): WorkflowStep {
  return {
    name: "create_mar",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.createMarInput;
      if (!isCreateMarInput(input)) {
        return { marCreationSkippedReason: "missing_or_invalid_input" };
      }
      const mar = await creator.createMar(input);
      return { mar };
    },
  };
}
