# Structured patient medicine search

The patient catalogue first searches canonical product names/aliases and asks the
patient to select a product, including strength, dosage form and route. Name
search is identity discovery only; it does not establish equivalence.

The equivalents API retrieves canonical products by ingredient IDs. Matching
requires a nonempty, unique ingredient set, complete per-ingredient amounts and
units, matching normalized strength (including any concentration denominator),
form and route, active records and current Nigerian NAFDAC catalogue registrations.
Amounts/units are compared conservatively: unsupported unit conversions do not
become exact matches. Same-ingredient records with incomplete evidence remain
review-only. Different-ingredient alternatives require an active, approved,
effective therapeutic relationship; therapeutic class or text similarity alone
is insufficient. Catalogue data must be validated by the existing catalogue
governance process before activation. No brand ingredients are inferred or seeded.

All filters and sorting execute on the backend. Ingredient selection uses IDs.
Prices are per unit in NGN; unknown prices do not satisfy price bounds. The
interface keeps exact, related and therapeutic results in separate sections.
Location consent is required for participating-pharmacy availability. No location
means unchecked inventory, not out of stock. Existing discovery excludes expired,
quarantined, ineligible and unavailable stock; include-unavailable retains catalogue
products with no eligible offers rather than exposing restricted batch records.

Apply migration `202609160086_catalogue_discovery_contacts.sql` before enabling
nearby catalogue searches. Its contact projection calls the existing marketplace
discovery function, preserving patient authorization, consent and participation
checks, and limits pharmacies to Nigeria. Directions use pharmacy coordinates;
Call is disabled when no valid phone is recorded. The existing reservation flow
requires a medication request and pharmacist review, so Reserve opens prescription
intake with the original prescribed brand prefilled; it does not automatically
substitute or create a reservation for an equivalent product.

No EMDEX integration is assumed or fabricated. A licensed provider must supply
stable ingredient/product identifiers, ingredient amounts and units with explicit
concentration bases, form, route, Nigerian registrations and provenance. Import
into governed canonical records only after validation. This change does not add
licensed data or verify registrations against a live regulatory feed.

Operational limits: catalogue candidate retrieval is paged; inventory discovery
currently runs once per filtered product and uses the existing service's single
eligible batch per pharmacy. Large ingredient families may need a batched discovery
RPC. Live database execution and authenticated browser acceptance testing are
required before release, including cross-tenant consent denial, contact visibility,
actual LOW_STOCK rows, registration expiry and reservation review enforcement.
