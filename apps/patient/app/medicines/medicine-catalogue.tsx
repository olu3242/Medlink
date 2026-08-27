"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface Medicine {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  route: string;
  manufacturer: string | null;
  controlled: boolean;
}

export function MedicineCatalogue() {
  const [query, setQuery] = useState("");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load(search = "") {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`/patient/api/v1/medicines?${params.toString()}`);
      if (!response.ok) throw new Error();
      const body = await response.json() as { data: Medicine[] };
      setMedicines(body.data);
    } catch {
      setMessage("The medicine catalogue is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query);
  }

  return (
    <section className="stack" aria-busy={loading}>
      <form className="card inline-search" onSubmit={search}>
        <div className="field grow">
          <label htmlFor="catalogue-query">Brand or generic name</label>
          <input
            id="catalogue-query"
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. paracetamol"
            type="search"
            value={query}
          />
        </div>
        <button className="button" disabled={loading} type="submit">
          Search catalogue
        </button>
      </form>
      {message ? <div className="error" role="alert">{message}</div> : null}
      {!message && !loading && medicines.length === 0 ? (
        <div className="card">
          <h2>No active medicines found</h2>
          <p className="muted">Try a different brand or generic name.</p>
        </div>
      ) : null}
      <div className="grid">
        {medicines.map((medicine) => (
          <article className="card" key={medicine.id}>
            <span className="status">
              {medicine.controlled ? "Controlled" : "Active"}
            </span>
            <h2>{medicine.brandName}</h2>
            <p>{medicine.genericName}, {medicine.strength}</p>
            <p className="muted">
              {medicine.dosageForm} · {medicine.route}
              {medicine.manufacturer ? ` · ${medicine.manufacturer}` : ""}
            </p>
            <Link className="secondary" href={`/patient/medicines/${medicine.id}`}>
              Medicine details
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
