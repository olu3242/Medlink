import type { CertificationProfile, PolicyCategory } from "./policy-types";

export const certificationProfiles: Readonly<Record<
  CertificationProfile["id"], CertificationProfile
>> = {
  development: { id: "development", categories: ["runtime", "quality"], threshold: 70 },
  staging: {
    id: "staging",
    categories: ["runtime", "security", "observability", "data", "quality"],
    threshold: 85,
  },
  production: {
    id: "production",
    categories: ["runtime", "security", "observability", "data", "quality"],
    threshold: 95,
  },
  enterprise: {
    id: "enterprise",
    categories: ["runtime", "security", "observability", "data", "quality"],
    threshold: 95,
  },
};

export function categoryFilter(value: string | null): PolicyCategory | undefined {
  return ["runtime", "security", "observability", "data", "quality"].includes(value ?? "")
    ? value as PolicyCategory : undefined;
}
