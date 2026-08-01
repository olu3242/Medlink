import { describe, expect, it } from "vitest";
import {
  MAX_PRESCRIPTION_FILE_SIZE_BYTES,
  sanitizePrescriptionFileName,
  validatePrescriptionFile,
} from "./file-intake";

describe("validatePrescriptionFile", () => {
  it("accepts an allowed MIME type within the size limit", () => {
    expect(validatePrescriptionFile({ mimeType: "image/jpeg", sizeBytes: 1024 }))
      .toEqual({ valid: true });
  });

  it("accepts a PDF", () => {
    expect(validatePrescriptionFile({ mimeType: "application/pdf", sizeBytes: 1024 }))
      .toEqual({ valid: true });
  });

  it("rejects an unsupported MIME type", () => {
    expect(validatePrescriptionFile({ mimeType: "video/mp4", sizeBytes: 1024 }))
      .toEqual({ valid: false, reason: "unsupported_mime_type" });
  });

  it("rejects a file over the size limit", () => {
    expect(validatePrescriptionFile({
      mimeType: "image/jpeg",
      sizeBytes: MAX_PRESCRIPTION_FILE_SIZE_BYTES + 1,
    })).toEqual({ valid: false, reason: "file_too_large" });
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validatePrescriptionFile({
      mimeType: "image/jpeg",
      sizeBytes: MAX_PRESCRIPTION_FILE_SIZE_BYTES,
    })).toEqual({ valid: true });
  });

  it("rejects an empty file", () => {
    expect(validatePrescriptionFile({ mimeType: "image/jpeg", sizeBytes: 0 }))
      .toEqual({ valid: false, reason: "empty_file" });
  });

  it("rejects a negative size", () => {
    expect(validatePrescriptionFile({ mimeType: "image/jpeg", sizeBytes: -1 }))
      .toEqual({ valid: false, reason: "empty_file" });
  });
});

describe("sanitizePrescriptionFileName", () => {
  it("passes through an ordinary file name unchanged", () => {
    expect(sanitizePrescriptionFileName("prescription.jpg")).toBe("prescription.jpg");
  });

  it("strips forward slashes that would otherwise add path segments", () => {
    // No literal "/" survives, so the result can never be reinterpreted as
    // additional path segments once it's placed after the generated
    // object-id prefix -- that's the actual security property, not the
    // exact leftover punctuation.
    const sanitized = sanitizePrescriptionFileName("../../other-patient/x.jpg");
    expect(sanitized).not.toContain("/");
    expect(sanitized).toBe("_.._other-patient_x.jpg");
  });

  it("strips backslashes the same way", () => {
    const sanitized = sanitizePrescriptionFileName("..\\..\\x.jpg");
    expect(sanitized).not.toContain("\\");
    expect(sanitized).toBe("_.._x.jpg");
  });

  it("strips leading dots after path separators are removed", () => {
    expect(sanitizePrescriptionFileName("...hidden.jpg")).toBe("hidden.jpg");
  });

  it("falls back to a safe default for a name that sanitizes to nothing", () => {
    expect(sanitizePrescriptionFileName("...")).toBe("file");
    expect(sanitizePrescriptionFileName("")).toBe("file");
  });
});
