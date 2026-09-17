"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CanonicalMedicine, FormulationGroup } from "@medlink/medicine";
import type { MedicationDiscoveryOption } from "@medlink/pharmacy";

interface SearchResult {
  source: "INTERNAL_CATALOGUE";
  pagination: { total: number; offset: number; limit: number; nextOffset: number | null };
  reference: CanonicalMedicine;
  availabilityChecked: boolean;
  facets: { ingredients: { id: string; name: string }[]; strengths: string[]; forms: string[]; routes: string[]; brands: string[]; manufacturers: string[]; units: string[]; ratios: string[] };
  results: { medicine: CanonicalMedicine; group: FormulationGroup; registered: boolean; differences: string[]; offers: (MedicationDiscoveryOption & { freshness: "fresh" | "stale" | "unknown" })[] }[];
}
const NON_FILTER_PARAMS = new Set(["medicineId", "offset", "latitude", "longitude", "locationConsent"]);
const sections = [
  ["exact", "Exact pharmaceutical matches", "Same ingredients, amounts and ratios, strength, form, and route. A pharmacist must assess changes to the prescribed product."],
  ["related", "Related formulations", "Same ingredients with a different or incompletely verified formulation. Not directly interchangeable."],
  ["therapeutic", "Therapeutic alternatives", "Require pharmacist or prescriber assessment. Never automatic substitutes."],
] as const;

export function MedicineCatalogue() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Pick<CanonicalMedicine, "id" | "brandName" | "genericName" | "strength" | "dosageForm" | "route">[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<SearchResult>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number }>();
  const form = useRef<HTMLFormElement>(null);
  const sequence = useRef(0);
  const restoredFromUrl = useRef(false);
  const initialFilters = useRef(new URLSearchParams(searchParams.toString()));
  const defaultValue = (name: string) => initialFilters.current.get(name) ?? undefined;

  useEffect(() => {
    if (restoredFromUrl.current) return;
    restoredFromUrl.current = true;
    const medicineId = initialFilters.current.get("medicineId");
    if (medicineId) void equivalents(medicineId, false, Number(initialFilters.current.get("offset") ?? 0), initialFilters.current);
    // Restore filter state from a shared or refreshed URL exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    const token = ++sequence.current;
    setLoading(true); setMessage(""); setSelected(""); setData(undefined); setProducts([]);
    try {
      const response = await fetch(`/patient/api/v1/medicines/search?q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (token === sequence.current) {
        setProducts(body.data.matches);
        if (!body.data.matches.length) setMessage("No validated product found. Try another brand or generic name.");
      }
    } catch { if (token === sequence.current) setMessage("The medicine catalogue is temporarily unavailable."); }
    finally { if (token === sequence.current) setLoading(false); }
  }
  async function equivalents(id: string, reset = false, offset = 0, overrideParams?: URLSearchParams) {
    const token = ++sequence.current;
    setSelected(id); setLoading(true); setMessage("");
    const params = new URLSearchParams({ medicineId: id, offset: String(offset) });
    if (overrideParams) {
      for (const [key, value] of overrideParams) if (!NON_FILTER_PARAMS.has(key) && value) params.append(key, value);
    } else if (!reset && form.current) {
      for (const [key, value] of new FormData(form.current)) if (String(value)) params.append(key, String(value));
    }
    if (location) { params.set("latitude", String(location.latitude)); params.set("longitude", String(location.longitude)); params.set("locationConsent", "true"); }
    try {
      const response = await fetch(`/patient/api/v1/medicines/equivalents?${params}`);
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (token === sequence.current) {
        setData(body.data);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    } catch { if (token === sequence.current) { setData(undefined); setMessage("Could not load matches. Check the price range and try again."); } }
    finally { if (token === sequence.current) setLoading(false); }
  }
  function locate() {
    if (!navigator.geolocation) { setLocationMessage("Location is unavailable in this browser."); return; }
    setLocationMessage("Requesting location…");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocation({ latitude: coords.latitude, longitude: coords.longitude });
      setLocationMessage("Location selected. Apply filters to check participating pharmacies.");
    }, () => setLocationMessage("Location could not be obtained. Catalogue comparison is still available."), { timeout: 10000, maximumAge: 60000 });
  }
  const select = (name: string, label: string, values: string[]) => <div className="field" key={name}>
    <label htmlFor={`filter-${name}`}>{label}</label><select id={`filter-${name}`} name={name} defaultValue={defaultValue(name) ?? ""}><option value="">All</option>{values.map((value) => <option key={value}>{value}</option>)}</select>
  </div>;
  return <section className="stack" aria-busy={loading}>
    <form className="card inline-search" onSubmit={search}>
      <div className="field grow"><label htmlFor="catalogue-query">Prescribed brand or generic name</label><input id="catalogue-query" type="search" minLength={2} maxLength={100} required value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Mirapain Gel" /></div>
      <button className="button" disabled={loading}>Find prescribed product</button>
    </form>
    {products.length > 0 && <section className="card"><h2>Identify your prescribed product</h2><p>Confirm the strength, form, and route before comparing brands.</p>
      <div className="field"><label htmlFor="prescribed-product">Product</label><select id="prescribed-product" value={selected} disabled={loading} onChange={(event) => { setData(undefined); void equivalents(event.target.value, true); }}>
        <option value="" disabled>Select your prescribed product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.brandName} — {product.genericName}, {product.strength}, {product.dosageForm}, {product.route}</option>)}
      </select></div></section>}
    {selected && <form key={selected} ref={form} className="card stack" onSubmit={(event) => { event.preventDefault(); void equivalents(selected); }}>
      <h2>Filter formulations and pharmacies</h2><div className="grid">
        <div className="field"><label htmlFor="filter-ingredient">Active ingredients</label><select id="filter-ingredient" name="ingredient" multiple defaultValue={initialFilters.current.getAll("ingredient")}>{data?.facets.ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label htmlFor="filter-quality">Match quality</label><select id="filter-quality" name="quality" defaultValue={defaultValue("quality") ?? "all"}><option value="all">All groups</option><option value="exact">Exact pharmaceutical match</option><option value="related">Related formulation / other strength</option><option value="therapeutic">Therapeutic alternative</option></select></div>
        {select("strength", "Strength", data?.facets.strengths ?? [])}{select("form", "Dosage form", data?.facets.forms ?? [])}{select("route", "Route", data?.facets.routes ?? [])}{select("brand", "Brand", data?.facets.brands ?? [])}{select("manufacturer", "Manufacturer", data?.facets.manufacturers ?? [])}
        {select("unit", "Ingredient unit", data?.facets.units ?? [])}
        {select("ratio", "Ratio / concentration", data?.facets.ratios ?? [])}
        <div className="field"><label htmlFor="filter-min-amount">Minimum ingredient amount</label><input id="filter-min-amount" name="minAmount" type="number" min="0" step="any" defaultValue={defaultValue("minAmount")} /></div>
        <div className="field"><label htmlFor="filter-max-amount">Maximum ingredient amount</label><input id="filter-max-amount" name="maxAmount" type="number" min="0" step="any" defaultValue={defaultValue("maxAmount")} /></div>
        <div className="field"><label htmlFor="filter-registered">Registration</label><select name="registered" id="filter-registered" defaultValue={defaultValue("registered") ?? "false"}><option value="false">Include unverified registration</option><option value="true">NAFDAC registered only</option></select></div>
        <div className="field"><label htmlFor="filter-availability">Availability</label><select name="availability" id="filter-availability" defaultValue={defaultValue("availability") ?? "all"}><option value="all">Include unavailable / unchecked</option><option value="in_stock">In stock now</option><option value="low_stock">Low stock</option></select></div>
        <div className="field"><label htmlFor="filter-radius">Distance radius (km)</label><input id="filter-radius" name="radiusKm" type="number" min="1" max="200" defaultValue={defaultValue("radiusKm") ?? "25"} /></div>
        <div className="field"><label htmlFor="filter-pharmacy">Preferred pharmacy name</label><input id="filter-pharmacy" name="pharmacy" maxLength={200} defaultValue={defaultValue("pharmacy")} /></div>
        <div className="field"><label htmlFor="filter-min">Minimum price (NGN per unit)</label><input id="filter-min" name="minPrice" type="number" min="0" step="0.01" defaultValue={defaultValue("minPrice")} /></div>
        <div className="field"><label htmlFor="filter-max">Maximum price (NGN per unit)</label><input id="filter-max" name="maxPrice" type="number" min="0" step="0.01" defaultValue={defaultValue("maxPrice")} /></div>
        <div className="field"><label htmlFor="filter-sort">Sort within each safety group</label><select name="sort" id="filter-sort" defaultValue={defaultValue("sort") ?? "exact"}><option value="exact">Best exact match</option><option value="nearest">Nearest pharmacy</option><option value="price">Lowest price</option><option value="freshness">Recently confirmed inventory</option><option value="brand">Brand name</option></select></div>
      </div><button type="button" className="secondary" onClick={locate}>Use my location</button><p role="status">{locationMessage}</p><button className="button" disabled={loading}>Apply filters</button>
      <button type="button" disabled={loading} className="secondary" onClick={() => { form.current?.reset(); void equivalents(selected, true); }}>Clear filters</button>
    </form>}
    {loading && <p role="status">Checking catalogue and pharmacy availability…</p>}{message && <p className="error" role="alert">{message}</p>}
    {data && !loading && <><p role="status">{data.pagination.total} matching products. Source: internal medicine catalogue.</p><p>Comparing with <strong>{data.reference.brandName}, {data.reference.strength} · {data.reference.dosageForm} · {data.reference.route}</strong>.</p>
      {!data.availabilityChecked && <p className="muted">Select your location and apply filters to check stock, distance, price, and confirmation times.</p>}
      {sections.map(([group, title, description]) => <section className="stack" key={group} aria-label={title}><h2>{title}</h2><p>{description}</p><div className="grid">
        {data.results.filter((result) => result.group === group).map(({ medicine, registered, offers, differences }) => <article className="card" key={medicine.id}>
          <h3>{medicine.brandName}</h3><p>{medicine.genericName}</p><p>{medicine.strength} · {medicine.dosageForm} · {medicine.route}</p>
          <p>{medicine.ingredients.map((item) => `${item.preferredName}: ${item.amount ?? "amount unverified"} ${item.unit ?? ""}`).join(" + ")}</p>
          <p>Manufacturer: {medicine.manufacturer ?? "Not recorded"}</p><p>NAFDAC: {registered ? "Current catalogue registration" : "Current registration unverified"}</p>
          {group !== "exact" && <p>Not an exact match: {differences.join(", ")}. Pharmacist/prescriber assessment required.</p>}
          {medicine.registrations.filter((item) => item.authorityCode === "NAFDAC" && item.countryCode === "NG").map((item) => <p key={item.id}>{item.registrationNumber}{item.validUntil ? ` · valid until ${item.validUntil}` : " · expiry not recorded"}</p>)}
          <Link href={`/patient/medicines/${medicine.id}`}>Medicine details</Link>
          {offers.length === 0 && <p>{data.availabilityChecked ? "No eligible stock returned in this radius." : "Inventory not checked."}</p>}
          {offers.map((offer) => <div key={offer.inventoryId} className="stack"><h4>{offer.pharmacyName}</h4><p>{offer.pharmacyLocality} · {offer.distanceKm.toFixed(1)} km</p><p>{offer.freshness === "fresh" ? offer.stockStatus.replaceAll("_", " ") : "Availability unconfirmed — stale or missing inventory confirmation"}</p>
            <p>Last confirmed: {Number.isFinite(Date.parse(offer.inventoryTimestamp)) ? new Date(offer.inventoryTimestamp).toLocaleString() : "Not recorded"}</p>
            <p>{offer.unitPriceMinor !== null && offer.currencyCode ? `${offer.currencyCode} ${(offer.unitPriceMinor / 100).toFixed(2)} per unit` : "Price unavailable"}</p>
            {group === "exact" && offer.reservationEligible ? <Link className="button" href={`/patient/prescriptions/new?medicine=${encodeURIComponent(data.reference.brandName)}`}>Reserve — start medication request</Link> : <p>Pharmacist assessment required before reservation.</p>}
            <a className="secondary" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(offer.pharmacyLatitude) && Number.isFinite(offer.pharmacyLongitude) ? `${offer.pharmacyLatitude},${offer.pharmacyLongitude}` : `${offer.pharmacyName} ${offer.pharmacyLocality ?? ""} Nigeria`)}`}>Directions</a>
            {offer.pharmacyPhone && /^\+?[\d\s()-]{5,30}$/.test(offer.pharmacyPhone) ? <a className="secondary" href={`tel:${offer.pharmacyPhone.replace(/[^+\d]/g, "")}`}>Call</a> : <button type="button" disabled title="Pharmacy telephone is not recorded">Call unavailable</button>}
          </div>)}
        </article>)}
      </div>{!data.results.some((result) => result.group === group) && <p className="muted">No results in this group on this page.</p>}</section>)}
      <nav aria-label="Result pages"><button type="button" className="secondary" disabled={loading || data.pagination.offset === 0} onClick={() => void equivalents(selected, false, Math.max(0, data.pagination.offset - data.pagination.limit))}>Previous page</button>
        <button type="button" className="secondary" disabled={loading || data.pagination.nextOffset === null} onClick={() => void equivalents(selected, false, data.pagination.nextOffset ?? 0)}>Next page</button></nav>
    </>}
  </section>;
}
