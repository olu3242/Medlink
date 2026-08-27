"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MatchInventoryButton({ marId, inventoryBatchId, pharmacyLocationId }: {
  marId: string;
  inventoryBatchId: string;
  pharmacyLocationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function match() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/patient/api/v1/mar/${marId}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inventoryBatchId,
        pharmacyLocationId,
        idempotencyKey: `inventory-match:${marId}:${inventoryBatchId}`,
      }),
    });
    if (!response.ok) {
      setMessage("This inventory match could not be recorded. Refresh and try again.");
      setBusy(false);
      return;
    }
    router.push(`/patient/reserve/${inventoryBatchId}?marId=${marId}&pharmacyLocationId=${pharmacyLocationId}`);
  }

  return <>
    <button className="button" disabled={busy} onClick={match} type="button">
      {busy ? "Recording match…" : "Review reservation"}
    </button>
    <p aria-live="polite">{message}</p>
  </>;
}
