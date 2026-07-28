export const marStates = [
  "created", "validated", "reviewed", "searching", "matched", "reserved",
  "paid", "dispensed", "completed", "cancelled",
] as const;
export type MarState = (typeof marStates)[number];

export interface MedicationAccessRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly prescriptionId: string;
  readonly state: MarState;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type MarActor =
  | { readonly kind: "patient"; readonly userId: string }
  | { readonly kind: "staff"; readonly userId: string }
  | { readonly kind: "pharmacist"; readonly userId: string; readonly licenseId: string }
  | { readonly kind: "system"; readonly service: string };

export interface MarTransitionCommand {
  readonly marId: string;
  readonly tenantId: string;
  readonly to: MarState;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly actor: MarActor;
  readonly reason?: string;
}

export interface MarTransitioned {
  readonly type: "mar.transitioned";
  readonly eventId: string;
  readonly marId: string;
  readonly tenantId: string;
  readonly from: MarState;
  readonly to: MarState;
  readonly actor: MarActor;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
  readonly reason?: string;
}
