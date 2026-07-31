import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PatientAddress,
  PatientPreferences,
  PatientProfile,
  PatientProfileInput,
  PatientProfileRepository,
} from "@medlink/patients";
import { RuntimeError } from "@medlink/runtime";

interface PatientProfileRow {
  organization_id: string;
  user_id: string;
  phone: string;
  whatsapp_phone: string | null;
  date_of_birth: string | null;
  address: PatientAddress;
  preferences: PatientPreferences;
  created_at: string;
  updated_at: string;
}

function map(row: PatientProfileRow): PatientProfile {
  return {
    tenantId: row.organization_id,
    userId: row.user_id,
    phone: row.phone,
    ...(row.whatsapp_phone ? { whatsappPhone: row.whatsapp_phone } : {}),
    ...(row.date_of_birth ? { dateOfBirth: row.date_of_birth } : {}),
    address: row.address,
    preferences: row.preferences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function values(
  tenantId: string,
  userId: string,
  input: PatientProfileInput,
) {
  return {
    organization_id: tenantId,
    user_id: userId,
    phone: input.phone,
    whatsapp_phone: input.whatsappPhone ?? null,
    date_of_birth: input.dateOfBirth ?? null,
    address: input.address,
    preferences: input.preferences,
    deleted_at: null,
  };
}

function databaseFailure(cause: unknown): RuntimeError {
  return new RuntimeError(
    "infrastructure",
    "patient_profile_database_failed",
    "The patient profile operation could not be completed",
    503,
    true,
    "Retry later.",
    { cause },
  );
}

export class SupabasePatientProfileRepository
implements PatientProfileRepository {
  constructor(private readonly database: SupabaseClient) {}

  async find(tenantId: string, userId: string): Promise<PatientProfile | null> {
    const { data, error } = await this.database.from("patient_profiles")
      .select("*")
      .eq("organization_id", tenantId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw databaseFailure(error);
    return data ? map(data as PatientProfileRow) : null;
  }

  async create(
    tenantId: string,
    userId: string,
    input: PatientProfileInput,
  ): Promise<PatientProfile> {
    const { data, error } = await this.database.from("patient_profiles")
      .insert(values(tenantId, userId, input))
      .select()
      .single();
    if (error || !data) throw databaseFailure(error);
    return map(data as PatientProfileRow);
  }

  async update(
    tenantId: string,
    userId: string,
    input: PatientProfileInput,
  ): Promise<PatientProfile | null> {
    const { organization_id, user_id, ...updates } =
      values(tenantId, userId, input);
    const { data, error } = await this.database.from("patient_profiles")
      .update(updates)
      .eq("organization_id", organization_id)
      .eq("user_id", user_id)
      .is("deleted_at", null)
      .select()
      .maybeSingle();
    if (error) throw databaseFailure(error);
    return data ? map(data as PatientProfileRow) : null;
  }

  async remove(tenantId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.database.from("patient_profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("organization_id", tenantId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .select("user_id")
      .maybeSingle();
    if (error) throw databaseFailure(error);
    return Boolean(data);
  }
}
