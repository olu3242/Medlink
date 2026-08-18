export const prescriptionMediaPolicy = {
  maximumBytes: 10 * 1024 * 1024,
  allowedMediaTypes: ["image/jpeg", "image/png", "application/pdf"],
} as const;

export interface PrescriptionUpload {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface PrescriptionScanResult {
  readonly status: "clean" | "rejected";
  readonly scanner: string;
  readonly signature?: string | undefined;
}

export interface PrescriptionScanner {
  scan(upload: PrescriptionUpload): Promise<PrescriptionScanResult>;
}

export interface PrescriptionStorage {
  store(input: {
    tenantId: string;
    patientId: string;
    upload: PrescriptionUpload;
    idempotencyKey: string;
    sha256: string;
  }): Promise<{ bucket: string; path: string; created: boolean }>;
  remove(bucket: string, path: string): Promise<void>;
}

export interface PrescriptionIntakeRepository {
  create(input: {
    tenantId: string;
    patientId: string;
    uploadedBy: string;
    bucket: string;
    path: string;
    mediaType: string;
    sizeBytes: number;
    sha256: string;
    scanner: string;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<{ prescriptionId: string; workflowId: string; status: "received" }>;
}

export interface PrescriptionIntegrity {
  sha256(bytes: Uint8Array): Promise<string>;
}

export class PrescriptionUploadRejectedError extends Error {
  readonly code = "prescription_upload_rejected";

  constructor(message = "The prescription file was rejected") {
    super(message);
    this.name = "PrescriptionUploadRejectedError";
  }
}

function matchesSignature(upload: PrescriptionUpload): boolean {
  const value = upload.bytes;
  if (upload.mediaType === "image/jpeg") {
    return value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
  }
  if (upload.mediaType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => value[index] === byte);
  }
  if (upload.mediaType === "application/pdf") {
    return [0x25, 0x50, 0x44, 0x46, 0x2d]
      .every((byte, index) => value[index] === byte);
  }
  return false;
}

function matchesFileNamePolicy(upload: PrescriptionUpload): boolean {
  const name = upload.fileName.trim();
  if (
    name.length === 0
    || name.length > 255
    || /[\\/]/.test(name)
    || [...name].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
    || name === "."
    || name === ".."
  ) return false;
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (upload.mediaType === "application/pdf") return extension === "pdf";
  if (upload.mediaType === "image/png") return extension === "png";
  if (upload.mediaType === "image/jpeg") {
    return extension === "jpg" || extension === "jpeg";
  }
  return false;
}

export class PrescriptionIntakeService {
  constructor(
    private readonly scanner: PrescriptionScanner,
    private readonly storage: PrescriptionStorage,
    private readonly repository: PrescriptionIntakeRepository,
    private readonly integrity: PrescriptionIntegrity,
  ) {}

  async intake(input: {
    tenantId: string;
    patientId: string;
    uploadedBy: string;
    upload: PrescriptionUpload;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<{ prescriptionId: string; workflowId: string; status: "received" }> {
    const { upload } = input;
    if (
      !prescriptionMediaPolicy.allowedMediaTypes.includes(
        upload.mediaType as typeof prescriptionMediaPolicy.allowedMediaTypes[number],
      )
      || upload.bytes.byteLength === 0
      || upload.bytes.byteLength > prescriptionMediaPolicy.maximumBytes
      || !matchesFileNamePolicy(upload)
      || !matchesSignature(upload)
    ) {
      throw new PrescriptionUploadRejectedError(
        "Prescription type, size, or file signature is invalid",
      );
    }

    const scan = await this.scanner.scan(upload);
    if (scan.status !== "clean") {
      throw new PrescriptionUploadRejectedError(
        "The prescription did not pass malware scanning",
      );
    }

    const sha256 = await this.integrity.sha256(upload.bytes);
    const stored = await this.storage.store({
      tenantId: input.tenantId,
      patientId: input.patientId,
      upload,
      idempotencyKey: input.idempotencyKey,
      sha256,
    });
    try {
      return await this.repository.create({
        tenantId: input.tenantId,
        patientId: input.patientId,
        uploadedBy: input.uploadedBy,
        bucket: stored.bucket,
        path: stored.path,
        mediaType: upload.mediaType,
        sizeBytes: upload.bytes.byteLength,
        sha256,
        scanner: scan.scanner,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        requestId: input.requestId,
      });
    } catch (error) {
      if (stored.created) {
        await this.storage.remove(stored.bucket, stored.path);
      }
      throw error;
    }
  }
}
