# Canonical Reference Data Dictionary (CRDD)

## Contract

Status: normative semantic baseline, version 1.0.0. This dictionary defines
meaning; physical PostgreSQL types and API representations may differ only
through explicit, lossless mappings. Every attribute records owner, source
assertions, valid time, system time, version, and certification state.

## Universal attributes

| Attribute | Type | Required | Rule |
| --- | --- | --- | --- |
| `id` | UUID | yes | Immutable, meaningless canonical identifier |
| `version` | integer | yes | Positive, monotonically increasing per entity |
| `scope` | enum | yes | `global` or `organization` |
| `organization_id` | UUID | conditional | Required for organization scope and RLS |
| `status` | enum | yes | Lifecycle-controlled, never arbitrary text |
| `valid_from` / `valid_to` | timestamp | yes/no | Business validity; non-overlapping where policy requires |
| `recorded_at` / `superseded_at` | timestamp | yes/no | System time in UTC |
| `certification_id` | UUID | conditional | Required for published versions |

## Entity dictionary

| Entity | Definition | Required identity | Owner | Search behavior |
| --- | --- | --- | --- | --- |
| Substance | Chemical or biological ingredient concept | preferred name, substance type | Clinical reference steward | name, synonym, authority code |
| Generic product | Clinical composition independent of brand | ingredients, strengths, form, route | Medicine steward | composition and names |
| Medicinal product | Marketed brand product | brand name, jurisdiction, authorization link | Medicine steward | brand, generic, registration |
| Packaged product | Saleable pack presentation | product, pack quantity/form | Medicine steward | identifiers and presentation |
| Organization | Legal or mastered organizational identity | preferred legal/display name | Organization steward | name, alias, identifier, location |
| Pharmacy reference | Licensed pharmacy identity and reference location | organization, license, jurisdiction | Pharmacy steward | name, license, locality |
| Regulatory authorization | Authority decision for a product | authority, jurisdiction, registration number, status | Regulatory steward | number, product, holder |
| Classification | Versioned taxonomy concept such as ATC | system, version, code, display | Terminology steward | code, display, synonym |
| Disease concept | Canonical disease/condition concept | terminology identifier or mastered key | Clinical terminology steward | code, name, synonym |
| Diagnosis concept | Diagnosis/billing representation | code system, version, code | Clinical terminology steward | code, display, mapping |
| Inventory item reference | Stable item identity used by inventory | organization namespace, item key, product/pack link | Inventory reference steward | SKU/barcode/product |
| Clinical assertion | Evidence-backed clinical relationship | type, subject, object/value, evidence | Clinical governance | policy-limited clinical search |
| Source assertion | Immutable claim from a source field | source release, record, field path, raw value | Source owner | auditor/reviewer only |

## High-value attributes

| Entity | Attribute | Type | Required | Validation / allowed value |
| --- | --- | --- | --- | --- |
| Substance | `preferred_name` | string | yes | 2–300 Unicode chars; governed capitalization |
| Substance | `salt_or_base_relation` | relationship | no | Typed link; salt stripping never destroys original identity |
| Generic product | `ingredients` | list | yes | At least one structured ingredient strength |
| Generic product | `dosage_form_id` | UUID | yes | Certified controlled vocabulary |
| Generic product | `route_ids` | UUID list | yes | One or more certified route concepts |
| Medicinal product | `brand_name` | string | yes | Original and normalized forms retained |
| Packaged product | `pack_quantity` | decimal | yes | Positive and paired with governed unit |
| Organization | `preferred_display_name` | string | yes | Survivorship decision with provenance |
| Pharmacy reference | `license_number` | string | conditional | Required where licensing authority provides one |
| Authorization | `registration_number` | string | yes | Unique within issuing authority and jurisdiction over validity |
| Classification | `code` | string | yes | Unique within system/version |
| Clinical assertion | `evidence` | list | yes | At least one eligible source reference |
| Clinical assertion | `clinical_status` | enum | yes | proposed, reviewed, certified, revoked |
| Inventory item reference | `live_quantity` | forbidden | n/a | Transactional; owned by Inventory Engine, never MERDP |

## Ingredient strength

Ingredient strength contains substance, role, numerator value/unit, optional
denominator value/unit, optional basis-of-strength substance, original
expression, and parse confidence. Units are governed and dimensionally checked.
Multi-ingredient products remain structured lists; concatenated generic text is
display-only.

## Source and ownership rules

Preferred sources and survivorship are attribute-specific and live in approved
policy, not this static dictionary. WHO INN may be preferred for an
international nonproprietary name but does not automatically override a local
regulator's authorization status. Search indexes only certified fields and
authorized preview fields, with aliases distinguishable from preferred values.

## Version policy

Identity-preserving corrections create a new entity version. A materially
different composition or legal entity creates a new canonical entity unless an
approved identity policy says otherwise. Published versions are immutable;
supersession and revocation are explicit. Breaking semantic changes require a
new CRDD major version and migration contract.

## Required expansion format

Before implementing a domain, expand every attribute with: business definition,
logical type, cardinality, requiredness, validation, controlled vocabulary,
source eligibility, owner/steward, sensitivity, temporal behavior, version
behavior, normalization, match use, search behavior, API/FHIR mapping, and
example. Generated schema and code MUST trace back to that entry.
