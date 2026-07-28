import { EvidenceRepository, SupabaseEvidenceStore } from "@medlink/runtime";
import { createSupabaseServerClient } from "./supabase/server";

export async function durableEvidenceRepository(): Promise<EvidenceRepository> {
  return new EvidenceRepository(
    new SupabaseEvidenceStore(await createSupabaseServerClient()),
  );
}
