# Entity Resolution Playbook (ERP)

## Principles

Entity resolution proposes identity; MDM authorizes and records identity
decisions. No single fuzzy score is clinical truth. Regulatory identifiers and
structured clinical composition take precedence over name similarity where
applicable. All merges are explainable, versioned, and reversible.

## Resolution pipeline

```text
prepare -> block -> generate candidates -> compute features -> apply constraints
-> score -> policy decision -> review when required -> merge/link or remain distinct
```

## Feature families

- exact authority-scoped business identifiers;
- normalized names and certified aliases;
- structured ingredients, strengths, form, and route;
- registration, jurisdiction, holder, and validity overlap;
- organization identifiers, address, jurisdiction, and role context;
- phonetic/transliteration similarity where linguistically justified;
- model similarity as an advisory feature only;
- negative constraints such as conflicting registrations or compositions.

Feature values, weights, rule/model versions, and evidence are persisted for
every decision.

## Decision bands

Thresholds are entity- and risk-specific configuration. The initial operating
pattern is:

| Band | Outcome |
| --- | --- |
| Policy-proven exact identity | Eligible for automatic acceptance |
| High confidence without hard conflict | Auto-accept only for approved low-risk classes |
| Ambiguous or clinically meaningful identity | Qualified human review |
| Low confidence | Remain distinct; do not assume a new entity is necessarily correct |
| Hard conflict or unsafe ambiguity | Quarantine and escalate |

The illustrative 95/85 thresholds are not universal defaults. They require
evaluation against labeled domain data, calibration, false-merge cost, and
specific approval. Medicine composition, clinical assertion, pharmacy legal
identity, and organization identity may use different thresholds and reviewers.

## Merge contract

A merge requires decision ID, candidate IDs/versions, feature evidence, policy
version, actor, reason, canonical survivor, crosswalk updates, field-level
survivorship decisions, downstream impact, and outbox events in one authorized
transaction. Source assertions are never deleted.

## Survivorship

Survivorship is per attribute. Policies may consider authority, jurisdiction,
freshness, completeness, clinical eligibility, validity period, and steward
decision. Last-write-wins and one global source ranking are prohibited.

## Unmerge

Unmerge reconstructs pre-merge identities from immutable assertions and merge
history, assigns corrected crosswalks, recomputes golden values, revokes affected
certification, emits compensating events, rebuilds projections, and records
consumer reconciliation. Tests MUST cover multi-level merge chains and partial
publication.

## Review requirements

Reviewers receive side-by-side sources, structured differences, feature
explanations, conflicting constraints, prior decisions, and downstream impact.
Clinical identity/equivalence requires qualified clinical authority. Overrides
require reasons and never silently retrain a model.

## Evaluation

Certification reports precision, recall, false-merge and missed-match rates by
entity/risk class, calibration, review volume, reviewer agreement, drift, and
unmerge frequency. Safety-critical false merges are hard failures regardless of
aggregate score.
