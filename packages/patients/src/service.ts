import type { PatientProfile, PatientProfileInput } from "./models";
import type { PatientProfileRepository } from "./ports";

export class PatientProfileAlreadyExistsError extends Error {
  readonly code = "patient_profile_exists";

  constructor() {
    super("The patient profile already exists");
    this.name = "PatientProfileAlreadyExistsError";
  }
}

export class PatientProfileNotFoundError extends Error {
  readonly code = "patient_profile_not_found";

  constructor() {
    super("The patient profile was not found");
    this.name = "PatientProfileNotFoundError";
  }
}

export class PatientProfileService {
  constructor(private readonly repository: PatientProfileRepository) {}

  get(tenantId: string, userId: string): Promise<PatientProfile | null> {
    return this.repository.find(tenantId, userId);
  }

  async create(
    tenantId: string,
    userId: string,
    input: PatientProfileInput,
  ): Promise<PatientProfile> {
    if (await this.repository.find(tenantId, userId)) {
      throw new PatientProfileAlreadyExistsError();
    }
    return this.repository.create(tenantId, userId, input);
  }

  async update(
    tenantId: string,
    userId: string,
    input: PatientProfileInput,
  ): Promise<PatientProfile> {
    const profile = await this.repository.update(tenantId, userId, input);
    if (!profile) throw new PatientProfileNotFoundError();
    return profile;
  }

  async remove(tenantId: string, userId: string): Promise<void> {
    if (!await this.repository.remove(tenantId, userId)) {
      throw new PatientProfileNotFoundError();
    }
  }
}
