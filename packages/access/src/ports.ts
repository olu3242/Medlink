import type { MedicationAccessRequest, MarTransitioned } from "./models";

export interface MarRepository {
  findById(tenantId: string, id: string): Promise<MedicationAccessRequest | null>;
  transitionAtomically(input: {
    readonly tenantId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly state: MedicationAccessRequest["state"];
    readonly updatedAt: Date;
  }): Promise<MedicationAccessRequest | null>;
}
export interface MarAuditSink { append(event: MarTransitioned): Promise<void>; }
export interface MarIdempotencyStore {
  find(key: string): Promise<MedicationAccessRequest | null>;
  record(key: string, result: MedicationAccessRequest): Promise<void>;
}
export interface IdGenerator { next(): string; }
export interface Clock { now(): Date; }
