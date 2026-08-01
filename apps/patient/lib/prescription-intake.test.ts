import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrescriptionFileStore, StoredPrescriptionFile } from "@medlink/prescription";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { PrescriptionIntakeApplication } from "./prescription-intake";

const context: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "patient",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

class RecordingFileStore implements PrescriptionFileStore {
  readonly storeCalls: unknown[] = [];
  readonly signedUrlCalls: Array<{ bucket: string; objectPath: string; expiresInSeconds: number }> = [];
  constructor(private readonly result: StoredPrescriptionFile) {}

  async store(input: unknown): Promise<StoredPrescriptionFile> {
    this.storeCalls.push(input);
    return this.result;
  }

  async createSignedUrl(bucket: string, objectPath: string, expiresInSeconds: number): Promise<string> {
    this.signedUrlCalls.push({ bucket, objectPath, expiresInSeconds });
    return `https://example.test/${bucket}/${objectPath}?expires=${expiresInSeconds}`;
  }
}

function fakeDatabase(result: { data: unknown; error: unknown }): {
  database: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: unknown }>;
} {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const database = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return result;
    },
  };
  return { database: database as unknown as SupabaseClient, rpcCalls };
}

const storedFile: StoredPrescriptionFile = {
  bucket: "prescriptions",
  objectPath: `${context.organizationId}/patient-1/object-1-x.jpg`,
  checksum: "checksum-1",
};

describe("PrescriptionIntakeApplication.upload", () => {
  it("rejects an unsupported file type without touching storage or the database", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database, rpcCalls } = fakeDatabase({ data: null, error: null });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    await expect(app.upload(context, {
      patientId: "patient-1",
      fileName: "a.mp4",
      mimeType: "video/mp4",
      bytes: new Uint8Array([1, 2, 3]),
      idempotencyKey: "key-1",
    })).rejects.toThrow();

    expect(fileStore.storeCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejects an oversized file the same way", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database, rpcCalls } = fakeDatabase({ data: null, error: null });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    await expect(app.upload(context, {
      patientId: "patient-1",
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      bytes: new Uint8Array(15 * 1024 * 1024 + 1),
      idempotencyKey: "key-1",
    })).rejects.toThrow();

    expect(fileStore.storeCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("stores the file then calls create_prescription_record with the resulting metadata", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database, rpcCalls } = fakeDatabase({
      data: { id: "prescription-1", status: "received", source: "upload" },
      error: null,
    });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    const result = await app.upload(context, {
      patientId: "patient-1",
      fileName: "prescription.jpg",
      mimeType: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3, 4]),
      idempotencyKey: "key-1",
    });

    expect(result).toEqual({ id: "prescription-1", status: "received", source: "upload" });
    expect(fileStore.storeCalls).toHaveLength(1);
    expect(rpcCalls).toEqual([{
      fn: "create_prescription_record",
      args: {
        target_organization_id: context.organizationId,
        target_actor_id: context.userId,
        target_correlation_id: context.correlationId,
        target_request_id: context.requestId,
        target_idempotency_key: "key-1",
        target_channel: context.channel,
        target_patient_id: "patient-1",
        target_source: "upload",
        target_storage_bucket: storedFile.bucket,
        target_storage_object_path: storedFile.objectPath,
        target_external_reference: null,
        target_storage_checksum: storedFile.checksum,
        target_storage_mime_type: "image/jpeg",
        target_storage_size_bytes: 4,
      },
    }]);
  });

  it("throws an infrastructure error when the RPC fails after a successful upload", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database } = fakeDatabase({ data: null, error: { message: "boom" } });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    await expect(app.upload(context, {
      patientId: "patient-1",
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      bytes: new Uint8Array([1]),
      idempotencyKey: "key-1",
    })).rejects.toThrow();
  });
});

function fakeDatabaseWithFrom(result: { data: unknown; error: unknown }): {
  database: SupabaseClient;
  fromCalls: string[];
} {
  const fromCalls: string[] = [];
  const database = {
    from: (table: string) => {
      fromCalls.push(table);
      return {
        select: () => ({
          eq: () => ({
            single: async () => result,
          }),
        }),
      };
    },
  };
  return { database: database as unknown as SupabaseClient, fromCalls };
}

describe("PrescriptionIntakeApplication.getFileUrl", () => {
  it("looks up the prescription's stored file and requests a 10-minute signed URL", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database, fromCalls } = fakeDatabaseWithFrom({
      data: { storage_bucket: "prescriptions", storage_object_path: "some/path.jpg" },
      error: null,
    });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    const url = await app.getFileUrl("prescription-1");

    expect(url).toBe("https://example.test/prescriptions/some/path.jpg?expires=600");
    expect(fromCalls).toEqual(["prescriptions"]);
    expect(fileStore.signedUrlCalls).toEqual([{
      bucket: "prescriptions", objectPath: "some/path.jpg", expiresInSeconds: 600,
    }]);
  });

  it("throws a 404-shaped error when the prescription has no stored file", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database } = fakeDatabaseWithFrom({
      data: { storage_bucket: null, storage_object_path: null },
      error: null,
    });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    await expect(app.getFileUrl("prescription-1")).rejects.toThrow();
    expect(fileStore.signedUrlCalls).toHaveLength(0);
  });

  it("throws an infrastructure error when the lookup fails", async () => {
    const fileStore = new RecordingFileStore(storedFile);
    const { database } = fakeDatabaseWithFrom({ data: null, error: { message: "not found" } });
    const app = new PrescriptionIntakeApplication(database, fileStore);

    await expect(app.getFileUrl("prescription-1")).rejects.toThrow();
  });
});
