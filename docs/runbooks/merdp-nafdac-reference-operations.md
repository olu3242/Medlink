# NAFDAC reference-data operations

NAFDAC's product listing is the authority for current product membership. The
manufacturer directory is the authority for manufacturer identities, while its
product relationships are supporting regulatory evidence. A relationship or
reachable historical detail page cannot independently make a product current,
certified, published, or runtime-visible.

The supported operating loop is `ACQUIRE -> SNAPSHOT -> DIFF -> RESOLVE -> REVIEW
WHERE NECESSARY -> CERTIFY -> PUBLISH -> EMIT EVENT`. Product and manufacturer
source IDs remain source identities; canonical UUIDs remain internal identities.
NRN and normalized names are evidence, never automatic primary keys.

Each acquisition verifies its hash and schema before immutable persistence.
Snapshot comparison classifies source IDs as `ADDED`, `CHANGED`, `MISSING`, or
`UNCHANGED`. Missing evidence is retained and never deletes canonical identity.
Changed values add evidence rather than rewriting historical raw records.

Manufacturer relationships for products outside the listing use
`OFF_LIST_SOURCE_EVIDENCE`. NRN-overlap evidence is ranked as high-confidence
historical evidence, ambiguous, or conflict. High confidence is not an automatic
merge or publication decision. Ambiguity and conflict use the existing MERDP
finding/review path. Insufficient evidence remains queryable without generating
review workload.

On failure, retry the immutable snapshot: matching hashes replay without duplicate
records. Convergence is transactional and may be rerun. Operators must verify zero
unexpected medicine, certification, publication, prescription, or inventory delta.
Fixtures 1161/9452, 370/718, and product 2087 are permanent safety gates.
