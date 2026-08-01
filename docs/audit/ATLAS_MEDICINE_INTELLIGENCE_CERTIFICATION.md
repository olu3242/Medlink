# Atlas Medicine Intelligence Certification (Engine AG-03)

Date: 2026-08-01. Scope: real medicine intelligence for Atlas -- medicine
normalization, catalog/fuzzy search, and duplicate-entry detection --
replacing the AGSDK-14 skeleton's placeholder "echo the input back
verbatim" prompt with structured, catalog-grounded logic. This document
extends, and should be read alongside, `docs/audit/AGENT_SDK_CERTIFICATION.md`
(the SDK Atlas is built on) and `docs/audit/AI_GATEWAY_CERTIFICATION.md`
(the Gateway Atlas's one LLM fallback path uses).

## Same agent, extended -- not a second Atlas

`packages/agents/src/atlas.ts`, the `"atlas"` `governedAgentCatalog`
entry, and `atlasPromptDefinitions` all already existed (the AGSDK-14
skeleton, built in the immediately preceding pass). This work extends
that exact file and that exact catalog entry -- same class name, same
agent id, same `invokeGovernedCapability`-adjacent authorization pattern
-- rather than introducing a second, competing "real" Atlas next to the
"skeleton" one.

## Retiring `medicine-match`: a pre-existing, unrelated duplicate found and closed

While researching what medicine-catalog infrastructure already existed
(before writing any Atlas code), a **second, older governed-agent
declaration** was found: `"medicine-match"`
(`packages/agents/src/registry.ts`, dating to the original AGL-1 pass),
with a `search_medicine` capability describing almost exactly what
Atlas's new `search_medicines` capability now does for real. Confirmed by
repository-wide search: nothing outside `registry.ts` ever referenced
`"medicine-match"` or `search_medicine` -- no workflow step, no route, no
test asserted its behavior. It was a declared-but-never-implemented
catalog entry, the identical situation Atlas itself was in one pass ago.

Rather than leave two agent identities both claiming "search the medicine
catalog" (one real, one a permanent stub), `medicine-match` is marked
`status: "retired"` with its mission field explaining why, pointing to
`AtlasAgent.search_medicines` as its replacement. This is not part of
what was asked for this pass -- it is a real, pre-existing duplicate this
work's own research surfaced, closed the same way this entire program has
closed every other duplicate-component finding (extend `packages/ai`
instead of a second gateway package; extend `registry.ts` instead of a
second `AgentRegistry`; now, retire the orphaned declaration instead of a
second search-capability owner).

## Knowledge source order, exactly as specified: Catalog -> Structured Lookup -> Fuzzy Search -> LLM -> Human Review

This is enforced by control flow, not by convention:

- **`search_medicines`** and **`detect_duplicate_medicines`** never
  construct a Gateway request at all -- there is no code path in either
  method that can reach `this.gateway.invoke()`. Both are pure
  catalog/search-service calls, wrapping `packages/search`'s existing
  `MedicineSearchService` (backed by the real `search_medicines` Postgres
  RPC, `pg_trgm` `similarity()`-ranked -- a genuine, already-existing
  relevance score, not fabricated for this pass).
- **`normalize_medicine_name`** tries, in order: (1) exact normalized-name
  match against the top search hit (confidence 1.0, `catalog_exact_match`),
  (2) a fuzzy match at or above a threshold (confidence = the real
  similarity score, `catalog_fuzzy_match`, `requiresHumanReview` set below
  a second, higher threshold), (3) only if neither clears its bar, a
  single AI Gateway call (`atlas_normalize_medicine_name` v0.2.0,
  authorized and prompt-registered exactly like every other Gateway call
  in this codebase) with a fixed low confidence (0.3) and
  `requiresHumanReview: true` unconditionally.

## Structured output, never free-form

Every capability returns a typed result (`AtlasNormalizationResult`,
`AtlasSearchResult`, `AtlasDuplicateDetectionResult`), never a raw string.
The one LLM-generated string (the fallback path's identification attempt)
is captured inside a typed `AtlasEvidence.description` field, not
returned as the response itself -- a caller cannot accidentally treat raw
model output as the structured result.

Both thresholds (`FUZZY_MATCH_ACCEPT_THRESHOLD = 0.4`,
`HIGH_CONFIDENCE_THRESHOLD = 0.8`) and the separate duplicate-detection
threshold (`NEAR_DUPLICATE_THRESHOLD = 0.6`) are named constants,
explicitly documented as heuristics against a real similarity score, not
certified clinical thresholds -- the same discipline
`alice-guardrail.ts` already applies to its own heuristic constants.

## Guardrails: what Atlas may and may not do

Exactly as specified, and structurally enforced, not just documented:

- Atlas may normalize, search, and classify (duplicate detection is a
  classification, not a decision). It does not summarize free text (no
  capability accepts or returns an open-ended summary).
- **Atlas never recommends a substitution or approves an alternative.**
  `possibleAlternatives` is a plain list of brand names sharing the
  matched generic ingredient -- no ranking, no "best" pick, no clinical
  reasoning attached. This is deliberately *not* wired to
  `packages/medicine`'s existing `CatalogEquivalencyService` (which
  already performs real clinical-equivalence reasoning with reason codes
  and a mandatory pharmacist-review gate) -- that is a different, already-
  governed concern this pass does not touch or duplicate.
- **Atlas never makes a clinical judgment.** No capability accepts patient
  context, dosage history, or clinical state; every capability operates
  only on catalog data and a free-text search term.
- `detect_duplicate_medicines` is restricted to `tenant_admin`/
  `platform_admin` (the roles that can actually create a medicine
  record) -- deliberately narrower than the other two capabilities'
  `patient`/`pharmacist`/`pharmacy_staff` allowlist, since a patient has
  no reason to check whether a catalog entry is a duplicate.

## What was deliberately scoped out, and why

- **"Conflicting strengths" duplicate detection** (from the original
  request's duplicate-detection scope) is **not built**. Investigated and
  found genuinely blocked: `packages/medicine`'s domain `BrandMedicine`
  type exposes `ingredients` (structured amount/unit) but not the DB's
  free-text `strength_display` column, and `MedicineSearchService`'s
  results carry only the domain type -- there is no comparable,
  already-available strength field to compare across two catalog entries
  without either reaching into an app-specific row-mapping type (breaking
  the ports/adapters boundary `packages/agents` observes everywhere else)
  or extending `BrandMedicine` itself (a cross-cutting change reaching
  into `packages/medicine`, every app's row mappers, and possibly
  `packages/search` -- out of scope for a single agent-capability PR).
  Named-and-deferred, not silently dropped.
- **No route wiring.** Unlike Alice, no `apps/*/app/api/v1/...` route
  calls `AtlasAgent` yet. The original request specified capabilities,
  guardrails, and output shape, not a consuming route or which app/
  endpoint should own it -- inventing that now would be a product/UX
  decision this pass was not asked to make. `AtlasAgent`'s constructor
  already takes real, production-capable ports
  (`MedicineCatalogReader`, `MedicineSearchService`, `AIGateway`), so
  wiring a route is additive, not architectural, work when a consumer is
  specified.
- **`DuplicateMedicineError`** (`packages/medicine/src/errors.ts`, defined
  since an earlier pass, never thrown anywhere) is **not** thrown by
  `detect_duplicate_medicines`. This capability is advisory (it flags
  candidates for a human to review before creating a record), not
  enforcement (it does not, and structurally cannot, block a write) --
  throwing an error implies a hard stop this capability does not own.
  `create_medicine_record` still has no duplicate check of its own,
  unchanged by this pass and unrelated to it.

## Test evidence

15 new tests in `atlas.test.ts`: exact match (no Gateway call, asserted
directly), fuzzy match above/below the human-review threshold, generic-
entity resolution with sibling-brand alternatives, both LLM-fallback
triggers (low score and zero matches), role-denial for all three
capabilities (including the duplicate-detection role restriction), ranked
search results, exact-duplicate and fuzzy-duplicate detection, and the
zero-duplicates case. Full repository `npm run check`: see verification
section below.

## Relationship to RC1 pilot readiness

Additive and orthogonal, same as every other AI Platform document in this
program -- does not close any of the four items `GO_NO_GO_SUMMARY.md`
names. The RC1 pilot verdict is unchanged.
