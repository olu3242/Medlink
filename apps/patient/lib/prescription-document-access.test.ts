import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabasePrescriptionDocumentAccess } from "./prescription-intake";

function databaseWithFile(file: {
  storage_bucket: string;
  storage_object_path: string;
} | null) {
  const signedUrlCalls: unknown[] = [];
  const database = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: file, error: null }),
            }),
          }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          signedUrlCalls.push({ bucket, path, expiresIn });
          return {
            data: { signedUrl: `https://storage.test/${bucket}/${path}?token=signed` },
            error: null,
          };
        },
      }),
    },
  };
  return {
    database: database as unknown as SupabaseClient,
    signedUrlCalls,
  };
}

describe("SupabasePrescriptionDocumentAccess", () => {
  it("signs only canonical private-bucket evidence for five minutes", async () => {
    const value = databaseWithFile({
      storage_bucket: "prescriptions-private",
      storage_object_path: "tenant/patient/source.pdf",
    });
    const url = await new SupabasePrescriptionDocumentAccess(value.database)
      .createSignedUrl("00000000-0000-4000-8000-000000000001");

    expect(url).toContain("token=signed");
    expect(value.signedUrlCalls).toEqual([{
      bucket: "prescriptions-private",
      path: "tenant/patient/source.pdf",
      expiresIn: 300,
    }]);
  });

  it.each([
    null,
    { storage_bucket: "prescriptions", storage_object_path: "tenant/patient/source.pdf" },
  ])("does not sign missing or legacy-bucket data", async (file) => {
    const value = databaseWithFile(file);
    await expect(new SupabasePrescriptionDocumentAccess(value.database)
      .createSignedUrl("00000000-0000-4000-8000-000000000001"))
      .rejects.toThrow("not found");
    expect(value.signedUrlCalls).toHaveLength(0);
  });
});
