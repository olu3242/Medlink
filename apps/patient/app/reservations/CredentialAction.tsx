"use client";
import { Alert, Button } from "@medlink/ui";
import { useState } from "react";
import { generatePickupCredential } from "../../lib/pickup-credential";

// Once issue_pickup_credential succeeds, the plaintext code lives only in
// this component's own React state -- never in a URL, a server log, an
// outbox payload, or localStorage/sessionStorage -- and disappears the
// moment the patient navigates away, matching "shown once."
export function CredentialAction(
  { reservationId, alreadyIssued }: { reservationId: string; alreadyIssued: boolean },
) {
  const [code, setCode] = useState<string | null>(null);
  const [issued, setIssued] = useState(alreadyIssued);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const credential = await generatePickupCredential();
      const response = await fetch(`/patient/api/v1/reservations/${reservationId}/credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupCodeHash: credential.hash }),
      });
      if (!response.ok) throw new Error();
      setCode(credential.code);
      setIssued(true);
    } catch {
      setError("The pickup code could not be generated. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <Alert title="Your pickup code">
        <p style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: ".08em" }}>{code}</p>
        <p className="muted">
          Show this code to the pharmacy when collecting your medication. It will not be shown again.
        </p>
      </Alert>
    );
  }
  if (issued) {
    return (
      <p className="muted">
        Pickup code already generated. Show your code to the pharmacy when collecting your medication.
      </p>
    );
  }
  return (
    <div className="actions">
      <Button disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate pickup code"}</Button>
      {error && <span role="alert" className="danger-text">{error}</span>}
    </div>
  );
}
