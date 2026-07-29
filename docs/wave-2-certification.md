# Wave 2 certification — Clinical Intelligence

## Scope

- Medicine Knowledge
- Medication Equivalency
- Prescription Intelligence
- Clinical validation and catalog search
- Admin catalog experience

Wave 1 packages remain frozen. The new Wave 2 migration is the only required
change under the shared Supabase directory.

## Safety invariants

- Equivalence candidates never auto-substitute.
- Every equivalence requires pharmacist review.
- OCR output always enters `needs_review`.
- Critical clinical findings create a hard stop until pharmacist acknowledgement.
- Prescription data is tenant-scoped and protected by RLS.

## API surface

- `GET|POST /api/v1/medicines`
- `GET|PATCH /api/v1/medicines/{id}`
- `GET /api/v1/brands`
- `GET /api/v1/generics`
- `GET|POST /api/v1/prescriptions`
- `POST /api/v1/prescriptions/{id}/extract` — runs `packages/prescription`'s
  `PrescriptionParser` against a placeholder OCR reader (no provider is
  selected yet) and commits the extraction atomically (migration 009)
- `POST /api/v1/prescriptions/{id}/validate` — runs `packages/clinical`'s
  `ClinicalValidationService` and commits the validation plus its findings
  atomically (migration 009)
- `GET /api/v1/equivalents?medicineId={uuid}`
- `PATCH /api/v1/equivalents/{id}/review` — records a tenant pharmacist's
  equivalence review decision via `packages/medicine`'s
  `CatalogEquivalencyService.assertReviewed`, committed atomically (migration
  009)
- `GET /api/v1/search?term=...` — `packages/search`'s
  `IndexedMedicineSearchService` backed by the existing brand trigram index;
  brand hits only (see "known gaps" below)

## Domain package wiring

As of this pass, `packages/medicine`, `packages/prescription`,
`packages/clinical`, and `packages/search` are no longer dead code with only
unit tests exercising them in isolation — each has at least one real
application-layer consumer and route, listed above. Batch 2.1's read paths
(`brands`/`generics`/catalog `list`/`get`) still query `medicines` directly
rather than through a `packages/medicine` repository; see "known gaps."

## Known gaps (discovered during wiring, not yet resolved)

These are genuine domain-model/schema mismatches, not just missing wiring,
and need a design decision (schema change vs. package model change) rather
than a mechanical fix:

- **No first-class generic-medicine entity.** `packages/medicine`'s
  `GenericMedicine` and `packages/search`'s generic search type model a
  generic medicine as a distinct entity with its own id. The `medicines`
  table stores `brand_name`/`generic_name` as two text columns on one row;
  there is no `generics` table. `findGenericById`/`listGenerics`/
  `createGeneric` and generic-type search results are consequently
  unimplemented (return empty/throw) rather than faked against the wrong
  table.
- **Prescription status vocabulary mismatch.** `packages/prescription`'s
  `PrescriptionRecord.status` uses `uploaded`/`processing`; the
  `prescriptions.status` DB enum uses `received`/`extracting`. Bridged with
  an explicit translation table in `apps/admin/lib/prescription-extraction.ts`
  rather than changing either vocabulary.
- **Clinical severity/kind vocabulary mismatch.** `packages/clinical`'s
  `ValidationFinding.severity` (`info`/`warning`/`critical`) is coarser than
  the `clinical_severity` DB enum (`informational`/`low`/`moderate`/`high`/
  `critical`), and `.code` is an open string against the closed
  `clinical_finding_kind` enum. Bridged with an explicit, documented mapping
  inside `record_clinical_validation` (migration 009); new clinical rules
  whose `code` doesn't match a known `kind` fall back to `'other'`.
- **Free-text vs. closed vocabulary for medicine attributes.**
  `packages/medicine`'s `dosageForms`/`administrationRoutes`/`strengthUnits`
  are closed enums; `medicines.dosage_form`/`route`/
  `medicine_ingredients.unit` are unconstrained text columns. The search
  reader (`apps/admin/lib/medicine-search.ts`) uses `safeParse` and skips
  rows that fail domain validation rather than throwing or coercing.

## Certification checklist

- [x] Strict TypeScript domain packages
- [x] Unit tests for parsing, validation, search, and equivalency
- [x] Versioned API boundaries with input validation
- [x] Responsive admin catalog UI
- [x] RLS and index migration reviewed statically
- [x] Domain packages wired into at least one real route each (see above)
- [ ] Migration executed against local Supabase
- [ ] API integration tests against local Supabase
- [ ] OCR provider adapter selected and credentials configured
- [ ] Generic-medicine entity gap resolved (schema or package model change)

The unchecked items require a local PostgreSQL/Supabase runtime, or a design
decision this pass deliberately didn't make unilaterally (see "known gaps").
Docker Desktop or Podman is not currently available on the build host.
