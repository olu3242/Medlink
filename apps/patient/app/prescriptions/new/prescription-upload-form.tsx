"use client";

import { useRef, useState, type FormEvent } from "react";

interface ProblemDetails { code?: string; detail?: string; recovery?: string }

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
  const [message, setMessage] = useState("");
  const idempotencyKey = useRef<string | null>(null);

  function selectFile() {
    idempotencyKey.current = crypto.randomUUID();
    setMessage("");
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024
      || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      setMessage("This file is invalid. Choose a genuine PDF, JPEG, or PNG under 10 MB.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/v1/prescriptions", {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey.current ??= crypto.randomUUID(),
        },
        body: form,
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as ProblemDetails | null;
        setMessage(uploadFailure(response.status, problem));
        return;
      }
      setMessage("Prescription received and queued for pharmacist review.");
      formElement.reset();
      idempotencyKey.current = null;
    } catch {
      setMessage("The network request failed. Nothing was recorded; check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={upload}>
      <h2>Prescription file</h2>
      <div className="field">
        <label htmlFor="file">Choose a prescription</label>
        <input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={selectFile}
          required
        />
      </div>
      <p className="muted">
        Files are malware-scanned before private storage. Uploading does not
        constitute clinical approval.
      </p>
      <div className="actions">
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Scanning and uploading..." : "Upload prescription"}
        </button>
        {message && <span role="status">{message}</span>}
      </div>
    </form>
  );
}
