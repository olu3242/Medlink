"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";

interface ProblemDetails { code?: string; detail?: string; recovery?: string }

const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
const maximumBytes = 10 * 1024 * 1024;

function uploadFailure(status: number, problem: ProblemDetails | null): string {
  if (status === 401) return "Your session has expired. Sign in again before uploading.";
  if (status === 403) return "Your account is not permitted to upload this prescription.";
  if (status === 413) return "This file is too large. Choose a file no larger than 10 MB.";
  if (problem?.code === "prescription_scanner_unavailable") {
    return "Prescription scanning is temporarily unavailable. Retry with the same file shortly.";
  }
  if (problem?.code === "prescription_upload_rejected") {
    return problem.detail?.toLowerCase().includes("malware")
      ? "This file did not pass the security scan and was not stored."
      : "This file was rejected. Choose a genuine PDF, JPEG, or PNG under 10 MB.";
  }
  if (status === 400 || status === 422) {
    return "This file is invalid. Choose a genuine PDF, JPEG, or PNG under 10 MB.";
  }
  return "The prescription could not be accepted. Nothing was recorded; retry with the same file.";
}

export function PrescriptionUploadForm() {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef<string | null>(null);

  function stageFile(file: File | undefined) {
    if (!file || file.size === 0 || file.size > maximumBytes || !allowedTypes.includes(file.type)) {
      setSelectedFile(null);
      setMessage("Choose a genuine PDF, JPEG, or PNG no larger than 10 MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (inputRef.current && inputRef.current.files?.[0] !== file) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      inputRef.current.files = transfer.files;
    }
    idempotencyKey.current = crypto.randomUUID();
    setSelectedFile(file);
    setMessage(`${file.name} is staged. Submit when you are ready to send it for pharmacist review.`);
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    stageFile(event.dataTransfer.files[0]);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setMessage("Choose or drop a prescription file before submitting for review.");
      return;
    }
    setBusy(true);
    setMessage("Scanning and securely uploading your prescription…");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/v1/prescriptions", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current ??= crypto.randomUUID() },
        body: form,
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as ProblemDetails | null;
        setMessage(uploadFailure(response.status, problem));
        return;
      }
      setMessage("Prescription uploaded and queued for pharmacist review. You can track it in Prescription history.");
      setSelectedFile(null);
      formElement.reset();
      idempotencyKey.current = null;
    } catch {
      setMessage("The network request failed. Nothing was recorded; check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card prescription-file-section" onSubmit={upload}>
      <h2>Upload the prescription file</h2>
      <label
        className={`prescription-dropzone${dragging ? " is-dragging" : ""}`}
        htmlFor="file"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <strong>{selectedFile ? "Prescription ready to submit" : "Drop a prescription here"}</strong>
        <span>{selectedFile
          ? `${selectedFile.name} · ${(selectedFile.size / 1024).toFixed(1)} KB`
          : "or choose a JPEG, PNG, or PDF up to 10 MB"}</span>
        <input
          aria-label="Choose a prescription"
          aria-describedby="file-guidance"
          aria-required="true"
          className="prescription-file-input"
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(event) => stageFile(event.target.files?.[0])}
          ref={inputRef}
          required
        />
      </label>
      <p className="muted" id="file-guidance">
        Files are malware-scanned before private storage. Nothing is uploaded until you submit.
      </p>
      <div className="prescription-submit-row">
        <button aria-busy={busy} className="button" type="submit" disabled={busy || !selectedFile}>
          {busy ? "Submitting for review…" : "Submit prescription for review"}
        </button>
        {message && <span aria-live="polite" role="status">{message}</span>}
      </div>
    </form>
  );
}
