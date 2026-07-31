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
- `GET /api/v1/medicines/{id}/equivalency-candidates` — runs
  `CatalogEquivalencyService.propose()` against
  `SupabaseMedicineCatalogReader` (brand-only) to find ingredient-matching
  candidates; added in the RC1 P0 convergence follow-up once `.propose()`
  was found to still have no caller even after `.assertReviewed()` was wired
- `GET /api/v1/search?term=...` — `packages/search`'s
  `IndexedMedicineSearchService` backed by the brand and generic trigram
  indexes (migrations 202607270002, 202607290011)

## Domain package wiring

`packages/medicine`, `packages/prescription`, `packages/clinical`, and
`packages/search` are no longer dead code with only unit tests exercising
them in isolation — each has real application-layer consumers and routes,
listed above, including both algorithmic domain methods on
`CatalogEquivalencyService` (`.propose()` and `.assertReviewed()`, not just
one of them). Batch 2.1's read paths (`brands`/`generics`/catalog `list`/
`get`) still query `medicines` directly rather than through a
`packages/medicine` repository — deliberately: they already return the
correct, tested response shape for the admin UI (see
`apps/admin/lib/application.test.ts`), and routing them through
`brandMedicineSchema`'s closed-vocabulary validation would risk 404ing an
existing medicine whose `dosage_form`/`route` falls outside that vocabulary,
for no functional gain. `SupabaseMedicineCatalogReader`
(`apps/admin/lib/medicine-repository.ts`) exists and is used for both
`.propose()` (brand side) and `findGenericById` (generic side, now backed by
the `generics` table added in migration 202607290011 — see "known gaps"
below for the resolution). Wiring it into `brands()`/`generics()`/catalog
`list()`/`get()` too remains a closed-vocabulary risk, not a missing
capability.

## Resolved gaps

- **First-class generic-medicine entity.** Resolved in migration
  `202607290011_generics.sql`: a `public.generics` table now backs
  `packages/medicine`'s `GenericMedicine` (`canonicalName`,
  `normalizedName`, `therapeuticClass`, `controlled`, `status`), distinct
  from `active_ingredients` (which remains the ingredient-composition
  source `CatalogEquivalencyService.propose()` uses — a different axis, not
  merged). Backfilled from every distinct existing `medicines.generic_name`;
  `medicines.generic_id` links each brand row to it, kept in sync going
  forward by a `sync_medicine_generic()` trigger rather than duplicated
  find-or-create logic in `create_medicine_record`/`update_medicine_record`.
  `medicines.generic_name` (text) is kept, not dropped — existing read paths
  depend on it directly. `SupabaseMedicineCatalogReader.findGenericById` and
  `SupabaseSearchMedicineReader.findGenericsByIds`
  (`apps/admin/lib/medicine-repository.ts`, `medicine-search.ts`) now query
  it for real instead of returning `null`/`[]` unconditionally, and
  `TrigramMedicineSearchIndex.search()` now returns real `generic`-type
  hits. `createGeneric`/`listGenerics` on `MedicineRepository` (the write
  side, as opposed to `MedicineCatalogReader`'s read side) remain
  unimplemented — no route calls them yet, so there was nothing to wire.
  Still an honest gap, same as `toBrandMedicine`'s existing precedent: a
  generic with no `therapeutic_class_id` assigned yet fails
  `genericMedicineSchema`'s required `therapeuticClass` and
  `toGenericMedicine` returns `null` for it rather than coercing.

## Known gaps (discovered during wiring, not yet resolved)

These are genuine domain-model/schema mismatches, not just missing wiring,
and need a design decision (schema change vs. package model change) rather
than a mechanical fix:

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

## Clinical rule set

`ClinicalValidationService` runs three rules, all advisory-only — none ever
auto-approve, auto-reject, or bypass the mandatory pharmacist review:

- `DuplicateTherapyRule` — flags when the requested medicine is already
  active for the patient.
- `PatientAllergyRule` — flags when a candidate medicine's active
  ingredients match a patient's declared allergies (`critical`, forces a
  hard stop until acknowledged).
- `PolypharmacyRiskRule` — flags five or more concurrent medications (a
  standard clinical heuristic, not specific-interaction checking).

## Certification checklist

- [x] Strict TypeScript domain packages
- [x] Unit tests for parsing, validation, search, and equivalency (3
      clinical rules, 135 total repository tests as of this pass)
- [x] Versioned API boundaries with input validation
- [x] API contract tests locking each Wave 2 write/search route's Zod schema
      to its real DB enum — added after a real drift was found and fixed by
      hand (`docs/audit/RC1_SPRINT_REPORT.md` Sprint 3); see each route's
      `route.contract.test.ts`
- [x] Static RLS assertions (enabled + policy exists) for all six Wave 2
      tables the routes above write to (`packages/runtime/src/
      wave2-rls.test.ts`) — not a substitute for a live cross-tenant denial
      matrix, but fails loudly if a future migration edit drops RLS or a
      policy
- [x] Responsive admin catalog UI, response-shape bugs found and fixed (the
      table previously rendered blank for every column but id/status — see
      `docs/audit/RC1_SPRINT_REPORT.md` Sprint 3)
- [x] RLS and index migration reviewed statically
- [x] Domain packages wired into real routes, including both algorithmic and
      assertion-style methods where a domain service has both
- [x] Generic-medicine entity gap resolved (`generics` table, migration
      202607290011 — see "Resolved gaps")
- [ ] Migration executed against local Supabase
- [ ] API integration tests against local Supabase
- [ ] OCR provider adapter selected and credentials configured

The unchecked items require a local PostgreSQL/Supabase runtime, or a design
decision this pass deliberately didn't make unilaterally (see "known gaps").
Docker Desktop and the Supabase CLI are both available on the build host;
the blocker is narrower than "no local infrastructure" — this session's
network egress policy doesn't allow the container-registry pulls
`supabase start` needs (confirmed via a 403 on
`production.cloudfront.docker.com`; see
`docs/audit/RC1_SPRINT_REPORT.md` Phase 1). Not a missing tool.
