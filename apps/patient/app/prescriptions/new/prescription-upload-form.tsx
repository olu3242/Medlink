"use client";

import { useRef, useState, type FormEvent } from "react";

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
    try {
      const response = await fetch("/api/v1/prescriptions", {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey.current ??= crypto.randomUUID(),
        },
        body: form,
      });
      if (!response.ok) throw new Error();
      setMessage("Prescription received and queued for pharmacist review.");
      formElement.reset();
      idempotencyKey.current = null;
    } catch {
      setMessage("The prescription could not be accepted. Check the file and retry.");
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
