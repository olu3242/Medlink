import { CatalogApplication } from "../../../lib/admin/application";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export default async function ProviderMedicinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const database = await createSupabaseServerClient();
  const { items, total } = await new CatalogApplication(database).list({
    query: q,
    status: "active",
    limit: 50,
  });

  return (
    <>
      <header className="head">
        <div>
          <div className="eyebrow">Canonical catalogue</div>
          <h1>Medicine search</h1>
          <p className="muted">
            Search the same regulated medicine catalogue used across MedLink before prescribing.
          </p>
        </div>
      </header>
      <form className="form card" role="search">
        <div className="field">
          <label htmlFor="q">Medicine, brand, or ingredient</label>
          <input id="q" name="q" defaultValue={q ?? ""} autoComplete="off" />
        </div>
        <div className="actions">
          <button className="button" type="submit">Search</button>
        </div>
      </form>
      <p className="muted" role="status">{total} matching {total === 1 ? "medicine" : "medicines"}</p>
      <div className="grid">
        {items.map((item) => (
          <article className="card" key={item.id}>
            <h2>{item.brandName}</h2>
            <p className="muted">{item.genericName} · {item.strength} · {item.dosageForm}</p>
          </article>
        ))}
        {!items.length ? (
          <div className="card">
            <h2>No matches</h2>
            <p className="muted">Try a different medicine name, brand, or ingredient.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
