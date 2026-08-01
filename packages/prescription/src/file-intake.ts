// G05 Prescription Intake Runtime, Engine 26. Mirrors migration
// 202608010003's bucket-level enforcement (file_size_limit,
// allowed_mime_types) at the application layer, so an invalid upload is
// rejected with a specific reason before any network call to storage, not
// just a generic storage-provider error after the fact.

export const allowedPrescriptionFileMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type PrescriptionFileMimeType = (typeof allowedPrescriptionFileMimeTypes)[number];

export const MAX_PRESCRIPTION_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export type PrescriptionFileValidationFailureReason =
  | "unsupported_mime_type"
  | "file_too_large"
  | "empty_file";

export interface PrescriptionFileValidationResult {
  readonly valid: boolean;
  readonly reason?: PrescriptionFileValidationFailureReason;
}

export function validatePrescriptionFile(input: {
  readonly mimeType: string;
  readonly sizeBytes: number;
}): PrescriptionFileValidationResult {
  if (input.sizeBytes <= 0) return { valid: false, reason: "empty_file" };
  if (input.sizeBytes > MAX_PRESCRIPTION_FILE_SIZE_BYTES) {
    return { valid: false, reason: "file_too_large" };
  }
  if (!(allowedPrescriptionFileMimeTypes as readonly string[]).includes(input.mimeType)) {
    return { valid: false, reason: "unsupported_mime_type" };
  }
  return { valid: true };
}

// Strips anything that could turn a user-supplied file name into a path
// segment of its own (slashes, backslashes, leading dots) before it's
// interpolated into a storage object key -- migration 202608010003's
// object-key convention is
// `{organization_id}/{patient_id}/{object id}-{filename}`, and an
// unsanitized filename like `../../other-patient/x.jpg` would otherwise
// let an uploader choose which folder (and therefore whose RLS-protected
// path) their own bytes land in.
export function sanitizePrescriptionFileName(fileName: string): string {
  const withoutPathSegments = fileName.replaceAll(/[/\\]/g, "_");
  const withoutLeadingDots = withoutPathSegments.replace(/^\.+/, "");
  const trimmed = withoutLeadingDots.trim();
  return trimmed.length > 0 ? trimmed : "file";
}

export interface StoredPrescriptionFile {
  readonly bucket: string;
  readonly objectPath: string;
  readonly checksum: string;
}

export interface PrescriptionFileStore {
  store(input: {
    readonly organizationId: string;
    readonly patientId: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }): Promise<StoredPrescriptionFile>;
  createSignedUrl(
    bucket: string,
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string>;
}
