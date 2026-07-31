import { z } from "zod";

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional();

export const patientProfileSchema = z.object({
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  whatsappPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  dateOfBirth: z.string().date().optional(),
  address: z.object({
    line1: z.string().trim().min(3).max(200),
    line2: optionalText(200),
    city: z.string().trim().min(2).max(100),
    state: z.literal("Lagos"),
    postalCode: optionalText(20),
    countryCode: z.literal("NG"),
  }),
  preferences: z.object({
    preferredLanguage: z.enum(["en", "yo", "ig", "ha"]),
    whatsappOptIn: z.boolean(),
    emailOptIn: z.boolean(),
  }),
}).superRefine((profile, context) => {
  if (profile.preferences.whatsappOptIn && !profile.whatsappPhone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whatsappPhone"],
      message: "A WhatsApp number is required when WhatsApp updates are enabled",
    });
  }
  if (
    profile.dateOfBirth
    && new Date(`${profile.dateOfBirth}T00:00:00.000Z`) > new Date()
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateOfBirth"],
      message: "Date of birth cannot be in the future",
    });
  }
});
