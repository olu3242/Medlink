import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabasePrescriptionFileStore } from "./prescription-storage";

// A minimal, hand-rolled fake of SupabaseClient.storage -- mirrors
// apps/web/lib/conversation-store.test.ts's scriptedSupabaseClient for the
// same reason: no SupabaseClient mock exists elsewhere in this repository
// to reuse, and this specific adapter's control flow (object-key
// construction, checksum computation, error mapping) is real logic worth
// covering directly.
function fakeStorageClient(script: {
  readonly uploadError?: { message: string };
  readonly signedUrlResult?: { data: { signedUrl: string } | null; error: { message: string } | null };
}) {
  const uploadCalls: Array<{ bucket: string; path: string; body: unknown; options: unknown }> = [];
  const signedUrlCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];

  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: unknown, options: unknown) => {
          uploadCalls.push({ bucket, path, body, options });
          return script.uploadError
            ? { data: null, error: script.uploadError }
            : { data: { path }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) => {
          signedUrlCalls.push({ bucket, path, expiresIn });
          return script.signedUrlResult ?? {
            data: { signedUrl: `https://example.test/${bucket}/${path}` },
            error: null,
          };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, uploadCalls, signedUrlCalls };
}

const organizationId = "00000000-0000-4000-8000-000000000001";
const patientId = "00000000-0000-4000-8000-000000000002";

describe("SupabasePrescriptionFileStore.store", () => {
  it("uploads to an object key scoped by organization then patient, matching migration 202608010003's RLS shape", async () => {
    const { client, uploadCalls } = fakeStorageClient({});
    const store = new SupabasePrescriptionFileStore(client);

    const result = await store.store({
      organizationId,
      patientId,
      fileName: "prescription.jpg",
      mimeType: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result.bucket).toBe("prescriptions");
    expect(result.objectPath.startsWith(`${organizationId}/${patientId}/`)).toBe(true);
    expect(result.objectPath.endsWith("-prescription.jpg")).toBe(true);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0]).toMatchObject({
      bucket: "prescriptions",
      path: result.objectPath,
      options: { contentType: "image/jpeg", upsert: false },
    });
  });

  it("computes a real sha-256 checksum of the file bytes", async () => {
    const { client } = fakeStorageClient({});
    const store = new SupabasePrescriptionFileStore(client);

    const result = await store.store({
      organizationId,
      patientId,
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      bytes: new TextEncoder().encode("hello"),
    });

    // sha256("hello"), a stable, independently-verifiable value.
    expect(result.checksum).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("produces a different object path for two uploads of the same file name", async () => {
    const { client } = fakeStorageClient({});
    const store = new SupabasePrescriptionFileStore(client);

    const first = await store.store({
      organizationId, patientId, fileName: "a.jpg", mimeType: "image/jpeg",
      bytes: new Uint8Array([1]),
    });
    const second = await store.store({
      organizationId, patientId, fileName: "a.jpg", mimeType: "image/jpeg",
      bytes: new Uint8Array([1]),
    });

    expect(first.objectPath).not.toBe(second.objectPath);
  });

  it("sanitizes a file name that would otherwise inject extra path segments", async () => {
    const { client, uploadCalls } = fakeStorageClient({});
    const store = new SupabasePrescriptionFileStore(client);

    await store.store({
      organizationId, patientId, fileName: "../../other-patient/x.jpg",
      mimeType: "image/jpeg", bytes: new Uint8Array([1]),
    });

    const uploadedPath = uploadCalls[0]?.path as string;
    // Exactly two "/" -- the organizationId/patientId separators -- no
    // matter what the file name contained.
    expect(uploadedPath.split("/")).toHaveLength(3);
  });

  it("throws an infrastructure error when the upload fails", async () => {
    const { client } = fakeStorageClient({ uploadError: { message: "bucket not found" } });
    const store = new SupabasePrescriptionFileStore(client);

    await expect(store.store({
      organizationId, patientId, fileName: "a.jpg", mimeType: "image/jpeg",
      bytes: new Uint8Array([1]),
    })).rejects.toThrow();
  });
});

describe("SupabasePrescriptionFileStore.createSignedUrl", () => {
  it("returns the provider's signed URL", async () => {
    const { client, signedUrlCalls } = fakeStorageClient({});
    const store = new SupabasePrescriptionFileStore(client);

    const url = await store.createSignedUrl("prescriptions", "some/path.jpg", 300);

    expect(url).toBe("https://example.test/prescriptions/some/path.jpg");
    expect(signedUrlCalls).toEqual([{ bucket: "prescriptions", path: "some/path.jpg", expiresIn: 300 }]);
  });

  it("throws an infrastructure error when signing fails", async () => {
    const { client } = fakeStorageClient({
      signedUrlResult: { data: null, error: { message: "object not found" } },
    });
    const store = new SupabasePrescriptionFileStore(client);

    await expect(store.createSignedUrl("prescriptions", "missing.jpg", 300)).rejects.toThrow();
  });
});
