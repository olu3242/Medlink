# Enterprise Certification Engine

The certification engine evaluates supplied evidence against modular, versioned
policies. It does not collect or persist evidence, enforce deployments, or perform
remediation.

## Policy lifecycle and providers

Policies declare stable IDs, versions, categories, required evidence, configurable
weights, failure text, and remediation guidance. Modules implement
`CertificationProvider` and register policies with `PolicyRegistry`; duplicate
provider ownership is rejected. Policy changes require version review.

## Profiles and scoring

Development, staging, production, and enterprise profiles select policy domains
and thresholds. The weighted percentage maps to:

- 95–100: Enterprise Certified
- 85–94: Conditionally Certified
- 70–84: Development Ready
- Below 70: Not Certified

A profile threshold can fail an otherwise recognized score band. Missing evidence
and evaluator errors fail closed.

## Administrative APIs

- `POST /runtime/certification?profile=enterprise` runs certification.
- `GET /runtime/certification` returns the latest process-local report.
- `GET /runtime/certification/report?format=markdown` returns Markdown; without the
  parameter it returns JSON.
- `GET /runtime/certification/policies?category=runtime` returns the policy catalog.

All endpoints require platform or tenant administrator authorization and disable
caching. Report persistence and immutable evidence are owned by S01.9 Batch 7.
