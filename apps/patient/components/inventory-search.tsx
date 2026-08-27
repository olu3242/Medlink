"use client";

import { useEffect, useState } from "react";
import type { Match } from "../lib/api";
import type { MedicationAvailabilityOutcome, MedicationDiscoveryResult } from "@medlink/pharmacy";
import { MatchInventoryButton } from "./match-inventory-button";

export function InventorySearch({ query, marId, medicineId }: {
  query: string; marId: string | undefined; medicineId: string | undefined;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(query));
  const [locationMessage, setLocationMessage] = useState("");
  const [outcome, setOutcome] = useState<MedicationAvailabilityOutcome>();

  useEffect(() => {
    let active = true;
    if (!query) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setFailed(false);
    setOutcome(undefined);
    const params = new URLSearchParams({ q: query });
    if (marId) params.set("marId", marId);
    fetch(`/patient/api/v1/inventory?${params}`, {
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Search unavailable");
      const body = await response.json() as { data: Match[] };
      if (active) setMatches(body.data);
    }).catch(() => active && setFailed(true)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [marId, query]);

  function searchNearby() {
    if (!medicineId) {
      setLocationMessage("Start from a medication request before searching nearby.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocationMessage("This browser does not support location. General tenant availability remains visible.");
      return;
    }
    setLoading(true);
    setFailed(false);
    setLocationMessage("Requesting location consent…");
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const params = new URLSearchParams({
          medicineId,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
          radiusKm: "25",
          locationConsent: "true",
        });
        if (marId) params.set("marId", marId);
        const response = await fetch(`/patient/api/v1/inventory?${params}`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Nearby search unavailable");
        const body = await response.json() as { data: MedicationDiscoveryResult };
        setMatches([...body.data.exact, ...body.data.generic]);
        setOutcome(body.data.outcome);
        setLocationMessage(`Showing participating pharmacies within 25 km: ${body.data.outcome}.`);
      } catch {
        setFailed(true);
        setLocationMessage("Nearby inventory could not be loaded.");
      } finally {
        setLoading(false);
      }
    }, (error) => {
      setLoading(false);
      setLocationMessage(error.code === error.PERMISSION_DENIED
        ? "Location permission was denied. General tenant availability remains visible."
        : "Your location could not be determined. General tenant availability remains visible.");
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
  }

  return <>
    <header className="head">
      <div>
        <div className="eyebrow">Medicine search</div>
        <h1>Find medicine nearby</h1>
        <p className="muted">Availability is confirmed when your reservation is accepted.</p>
      </div>
    </header>
    <form className="card" method="get">
      <input type="hidden" name="marId" value={marId ?? ""} />
      <div className="field">
        <label htmlFor="q">Brand or generic medicine</label>
        <input id="q" name="q" defaultValue={query} required placeholder="e.g. metformin 500 mg" />
      </div>
      <button className="button" type="submit">Search availability</button>
      {medicineId ? (
        <button className="button secondary" type="button" onClick={searchNearby}>
          Use my location
        </button>
      ) : null}
      <p aria-live="polite" className="muted">{locationMessage}</p>
    </form>
    {failed ? <p className="error" role="alert">Search is temporarily unavailable.</p> : null}
    {loading ? <p className="muted" role="status">Searching available inventory…</p> : null}
    {!failed && !loading && query ? <section aria-label="Search results" className="grid" style={{ marginTop: "1rem" }}>
      {outcome ? <p className="muted">Availability outcome: <strong>{outcome}</strong></p> : null}
      {matches.length ? matches.map((match) => <article className="card" key={match.inventoryId}>
        <span className="status">{match.relationship === "generic_related" ? "Generic option" : "Exact medicine"}</span>
        <h2>{match.medicineName}</h2>
        <p>{match.pharmacyName}</p>
        <p className="muted">{match.pharmacyLocality ?? "Location unavailable"}</p>
        {match.distanceKm !== undefined ? <p>{match.distanceKm.toFixed(1)} km away</p> : null}
        {match.priceStatus === "AVAILABLE" && match.unitPriceMinor != null
          ? <p>{match.currencyCode} {(match.unitPriceMinor / 100).toFixed(2)}</p>
          : match.priceStatus === "PRICE_NOT_AVAILABLE"
            ? <p className="muted">Price not available</p>
            : null}
        {match.relationship === "generic_related" ? <p className="muted">
          Governance: pharmacist review required before reservation.
        </p> : null}
        {marId && match.reservationEligible !== false ? <MatchInventoryButton
          marId={marId}
          inventoryBatchId={match.inventoryId}
          pharmacyLocationId={match.pharmacyLocationId}
        /> : match.relationship === "generic_related"
          ? null
          : <p className="muted">Start from your medication request to reserve.</p>}
      </article>) : <div className="card">
        <h2>{outcome === "NONE_AVAILABLE" ? "No medicine available nearby" : "No nearby matches"}</h2>
        <p className="muted">No reservation can be created from this result. Try a wider search area or check again later.</p>
      </div>}
    </section> : null}
  </>;
}
