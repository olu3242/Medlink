# Track A S01.10 and Wave 2.1–2.4 Source Certification

## Status

Conditional. Source gates pass; live PostgreSQL, RLS, OCR-provider, and API
integration evidence remain required.

## S01.10 Enterprise Test Harness

- CI runs lint, strict TypeScript, unit tests, coverage thresholds, builds, and
  workspace typechecks.
- Coverage fails below 55% lines/functions/statements or 50% branches.
- A secret-gated live Supabase job exercises the live database suite.

## Wave 2.1 Medicine Knowledge

- `MedicineCatalogService` owns catalog reads and validated creation commands.
- Missing medicines return typed domain errors.
- Repository ports remain infrastructure-independent.

## Wave 2.2 Medication Equivalency

- Pharmaceutical matching remains ingredient, strength, form, and route exact.
- No candidate can auto-substitute.
- `PharmacistEquivalencyService` records attributed, reasoned human decisions.

## Wave 2.3 Prescription Intelligence

- Upload policy accepts JPEG, PNG, and PDF within the configured size limit.
- Every OCR result enters pharmacist review.
- Confidence threshold remains configurable and low confidence never advances a
  prescription automatically.

## Wave 2.4 Clinical Intelligence

- Duplicate-therapy and ingredient-allergy rules are executable.
- Allergy conflicts are critical hard stops.
- A named pharmacist and rationale are required to acknowledge a hard stop.

## Evidence

- `npm run check`: pass
- `npm run test:coverage`: pass
- 90 tests pass; one live-database test is skipped without configured secrets
- Live migration/RLS and OCR adapter certification: pending

## Wave 2.5 Search

- PostgreSQL trigram search ranks brand, generic, and manufacturer matches.
- The Supabase index adapter preserves ranking and uses stable cursors.
- `/api/v1/search` runs through the canonical authenticated API pipeline.
- Search returns active catalog records only and does not expose tenant data.
- Adapter, ranking, pagination, strict type, coverage, and production-build
  source gates pass.
