"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivePortal } from "@medlink/platform";

interface NavDestination {
  label: string;
  href: string;
}

interface MedicineHit {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  matchedOn: string;
}

const MEDICINE_BROWSE_ROUTE: Partial<Record<ActivePortal, string>> = {
  patient: "/patient/medicines",
  provider: "/provider/medicines",
  admin: "/admin/catalog",
};

export function GlobalSearch({ portal, navigation }: { portal: ActivePortal; navigation: NavDestination[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [medicines, setMedicines] = useState<MedicineHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const browseRoute = MEDICINE_BROWSE_ROUTE[portal];

  const pages = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 1) return [];
    return navigation.filter((item) => item.label.toLowerCase().includes(term)).slice(0, 5);
  }, [query, navigation]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setMedicines([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { data: { medicines: [] } }))
        .then((body: { data: { medicines: MedicineHit[] } }) => setMedicines(body.data.medicines))
        .catch(() => {});
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const resultCount = pages.length + medicines.length;
  const showResults = open && query.trim().length > 0;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showResults) return;
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, resultCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      const target = document.querySelectorAll<HTMLAnchorElement>("[data-global-search-result]")[activeIndex];
      target?.click();
    }
  }

  return (
    <div className="ml-global-search" ref={containerRef}>
      <input
        type="search"
        className="ml-input"
        placeholder="Search MedLink…"
        aria-label="Search MedLink"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showResults ? (
        <div className="ml-global-search-results" role="listbox">
          {resultCount === 0 ? (
            <p className="muted ml-global-search-empty">No matches for &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <>
              {pages.length > 0 ? (
                <div className="ml-global-search-group">
                  <span className="ml-global-search-group-label">Pages</span>
                  {pages.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-global-search-result
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
              {medicines.length > 0 ? (
                <div className="ml-global-search-group">
                  <span className="ml-global-search-group-label">Medicines</span>
                  {medicines.map((medicine) =>
                    browseRoute ? (
                      <Link
                        key={medicine.id}
                        href={`${browseRoute}?q=${encodeURIComponent(medicine.brandName)}`}
                        data-global-search-result
                        onClick={() => setOpen(false)}
                      >
                        {medicine.brandName} <span className="muted">{medicine.strength} · {medicine.dosageForm}</span>
                      </Link>
                    ) : (
                      <span key={medicine.id} className="ml-global-search-static">
                        {medicine.brandName} <span className="muted">{medicine.strength} · {medicine.dosageForm}</span>
                      </span>
                    ),
                  )}
                  {browseRoute ? (
                    <Link href={`${browseRoute}?q=${encodeURIComponent(query.trim())}`} data-global-search-result onClick={() => setOpen(false)}>
                      View full medicine catalogue →
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
