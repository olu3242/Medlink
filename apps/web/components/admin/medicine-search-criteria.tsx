"use client";

import { useState } from "react";
import { criteriaForPreset, defaultMatchCriteria, type MatchCriteria, type SearchPreset } from "@medlink/medicine/intelligence";

const fields: readonly [keyof MatchCriteria, string][] = [
  ["activeIngredient", "Active ingredients"],
  ["strength", "Strength"],
  ["dosageForm", "Dosage form"],
  ["route", "Route"],
  ["activeRegistration", "Active registration"],
  ["manufacturer", "Manufacturer"],
  ["pharmacyAvailability", "Pharmacy availability"],
  ["inStockOnly", "In stock only"],
];

const presets: readonly [SearchPreset, string][] = [
  ["EXACT_EQUIVALENT", "Exact equivalent"],
  ["SAME_INGREDIENT", "Same ingredient"],
  ["BROAD_CATALOG", "Broad catalogue"],
  ["AVAILABILITY", "Availability"],
];

export function MedicineSearchCriteria({ selected }: { readonly selected?: string | undefined }) {
  const selectedKeys = new Set(selected?.split(",").filter(Boolean));
  const initialCriteria = selected === undefined
    ? defaultMatchCriteria
    : Object.fromEntries(fields.map(([key]) => [key, selectedKeys.has(key)])) as unknown as MatchCriteria;
  const [criteria, setCriteria] = useState<MatchCriteria>(initialCriteria);

  function applyPreset(preset: SearchPreset) {
    setCriteria(criteriaForPreset(preset));
  }

  function reset() {
    setCriteria(defaultMatchCriteria);
  }

  function clear() {
    setCriteria(Object.fromEntries(fields.map(([key]) => [key, false])) as unknown as MatchCriteria);
  }

  return (
    <fieldset className="search-criteria">
      <legend>Match criteria</legend>
      <div className="segmented-control" aria-label="Search mode">
        {presets.map(([value, label]) => (
          <button key={value} type="button" onClick={() => applyPreset(value)}>{label}</button>
        ))}
      </div>
      <div className="checkbox-grid">
        <input
          name="match"
          type="hidden"
          value={fields.filter(([key]) => criteria[key]).map(([key]) => key).join(",")}
        />
        {fields.map(([key, label]) => (
          <label key={key}>
            <input
              checked={criteria[key]}
              onChange={(event) => setCriteria((current) => ({ ...current, [key]: event.target.checked }))}
              type="checkbox"
              value={key}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="filter-actions">
        <button type="button" onClick={reset}>Reset to defaults</button>
        <button type="button" onClick={clear}>Clear all</button>
      </div>
    </fieldset>
  );
}
