export interface PatientAddress {
  readonly line1: string;
  readonly line2?: string | undefined;
  readonly city: string;
  readonly state: string;
  readonly postalCode?: string | undefined;
  readonly countryCode: "NG";
}

export interface PatientPreferences {
  readonly preferredLanguage: "en" | "yo" | "ig" | "ha";
  readonly whatsappOptIn: boolean;
  readonly emailOptIn: boolean;
}

export interface PatientProfile {
  readonly tenantId: string;
  readonly userId: string;
  readonly phone: string;
  readonly whatsappPhone?: string | undefined;
  readonly dateOfBirth?: string | undefined;
  readonly address: PatientAddress;
  readonly preferences: PatientPreferences;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PatientProfileInput {
  readonly phone: string;
  readonly whatsappPhone?: string | undefined;
  readonly dateOfBirth?: string | undefined;
  readonly address: PatientAddress;
  readonly preferences: PatientPreferences;
}
