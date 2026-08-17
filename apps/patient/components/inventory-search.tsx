"use client";

import { useEffect, useState } from "react";
import type { Match } from "../lib/api";
import { MatchInventoryButton } from "./match-inventory-button";

export function InventorySearch({ query, marId }: { query: string; marId: string | undefined }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(query));

  useEffect(() => {
    let active = true;
    if (!query) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setFailed(false);
    fetch(`/api/v1/inventory?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Search unavailable");
      const body = await response.json() as { data: Match[] };
      if (active) setMatches(body.data);
    }).catch(() => active && setFailed(true)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query]);

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
    </form>
    {failed ? <p className="error" role="alert">Search is temporarily unavailable.</p> : null}
    {loading ? <p className="muted" role="status">Searching available inventory…</p> : null}
    {!failed && !loading && query ? <section aria-label="Search results" className="grid" style={{ marginTop: "1rem" }}>
      {matches.length ? matches.map((match) => <article className="card" key={match.inventoryId}>
        <span className="status">{match.stockStatus}</span>
        <h2>{match.medicineName}</h2>
        <p>{match.pharmacyName}</p>
        <p className="muted">{match.pharmacyLocality ?? "Location unavailable"}</p>
        {marId ? <MatchInventoryButton
          marId={marId}
          inventoryBatchId={match.inventoryId}
          pharmacyLocationId={match.pharmacyLocationId}
        /> : <p className="muted">Start from your medication request to reserve.</p>}
      </article>) : <div className="card">
        <h2>No nearby matches</h2>
        <p className="muted">Try a generic name or wider search area.</p>
      </div>}
    </section> : null}
  </>;
}
