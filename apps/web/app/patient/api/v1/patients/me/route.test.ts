import { describe, expect, it } from "vitest";
import { patientProfileSchema } from "./profile-schema";

const valid = {
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

describe("patient profile API contract", () => {
  it("accepts a Lagos pilot patient profile", () => {
    expect(patientProfileSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a WhatsApp number when updates are enabled", () => {
    const result = patientProfileSchema.safeParse({
      ...valid,
      whatsappPhone: undefined,
    });
    expect(result.success).toBe(false);
  });

  it("rejects future birth dates and local-only phone formats", () => {
    expect(patientProfileSchema.safeParse({
      ...valid,
      phone: "08012345678",
      dateOfBirth: "2999-01-01",
    }).success).toBe(false);
  });
});
