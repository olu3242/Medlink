import type { PatientProfile, PatientProfileInput } from "./models";

export interface PatientProfileRepository {
  find(tenantId: string, userId: string): Promise<PatientProfile | null>;
  create(
    tenantId: string,
    userId: string,
    input: PatientProfileInput,
  ): Promise<PatientProfile>;
  update(
    tenantId: string,
    userId: string,
    input: PatientProfileInput,
  ): Promise<PatientProfile | null>;
  remove(tenantId: string, userId: string): Promise<boolean>;
}
