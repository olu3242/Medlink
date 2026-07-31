import { describe, expect, it, vi } from "vitest";
import type { PatientProfile, PatientProfileInput } from "./models";
import type { PatientProfileRepository } from "./ports";
import {
  PatientProfileAlreadyExistsError,
  PatientProfileNotFoundError,
  PatientProfileService,
} from "./service";

const input: PatientProfileInput = {
  phone: "+2348012345678",
  whatsappPhone: "+2348012345678",
  dateOfBirth: "1990-01-01",
  address: {
    line1: "1 Pilot Street",
    city: "Ikeja",
    state: "Lagos",
    countryCode: "NG",
  },
  preferences: {
    preferredLanguage: "en",
    whatsappOptIn: true,
    emailOptIn: false,
  },
};

const profile: PatientProfile = {
  tenantId: "tenant-1",
  userId: "user-1",
  ...input,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

function repository(
  overrides: Partial<PatientProfileRepository> = {},
): PatientProfileRepository {
  return {
    find: vi.fn(async () => null),
    create: vi.fn(async () => profile),
    update: vi.fn(async () => profile),
    remove: vi.fn(async () => true),
    ...overrides,
  };
}

describe("patient profile service", () => {
  it("creates a tenant-scoped patient profile", async () => {
    const store = repository();
    const result = await new PatientProfileService(store).create(
      "tenant-1",
      "user-1",
      input,
    );

    expect(result).toEqual(profile);
    expect(store.create).toHaveBeenCalledWith("tenant-1", "user-1", input);
  });

  it("rejects duplicate profiles", async () => {
    const service = new PatientProfileService(repository({
      find: vi.fn(async () => profile),
    }));

    await expect(service.create("tenant-1", "user-1", input))
      .rejects.toBeInstanceOf(PatientProfileAlreadyExistsError);
  });

  it("fails closed when update or removal targets no profile", async () => {
    const service = new PatientProfileService(repository({
      update: vi.fn(async () => null),
      remove: vi.fn(async () => false),
    }));

    await expect(service.update("tenant-1", "user-1", input))
      .rejects.toBeInstanceOf(PatientProfileNotFoundError);
    await expect(service.remove("tenant-1", "user-1"))
      .rejects.toBeInstanceOf(PatientProfileNotFoundError);
  });
});
