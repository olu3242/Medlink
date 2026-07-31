# Production Readiness Engines 11–15

Date: 2026-07-30

## Engine 11 — Compliance and governance

- Maintains versioned policies, standards, controls, procedures, and clinical,
  engineering, security, and release governance records.
- Requires effective approved policy versions and current acknowledgements.
- Validates time-bounded approved exceptions and waiver rationale.
- Requires hashed evidence for audit, consent, access review, privileged
  activity, retention, encryption, configuration, tenant isolation, RLS, and
  immutable audit controls.

## Engine 12 — Release governance

- Models development through production-certification lifecycle stages.
- Requires runtime, live database, hosted RLS, migration, security,
  observability, clinical, compliance, backup, DR, and human-approval evidence.
- Enforces freezes, maintenance windows, and rollback approval.
- Emergency and hotfix paths cannot bypass mandatory certification.

## Engine 13 — Certification evidence repository

- Supports the required runtime through approval artifact categories.
- Artifacts include timestamp, full commit SHA, GitHub Actions run ID,
  environment, certification version, duration, status, payload, and optional
  signature.
- Canonical SHA-256 hashing and append-only duplicate rejection preserve
  immutability.

## Engine 14 — Human approvals

- Requires Engineering, Clinical, Security, Operations, Compliance, Product,
  and Executive Release Authority decisions.
- Supports approval, rejection, requested changes, conditional approval,
  delegation, expiration, comments, evidence hashes, and signatures.
- Unsatisfied conditions, invalid delegation, missing signatures, and expired
  decisions fail closed.

## Engine 15 — Production certification dashboard

- Derives state across 17 mandatory certification domains.
- Reports exact missing and failing domains.
- Any failed, conditional, expired, malformed, or missing mandatory evidence
  immediately degrades certification and blocks deployment and Wave 2.5.

## Validation

- `npm run check`: pass
- 241 source tests pass; 8 hosted tests are credential-gated locally
- RC1-GA Engines 16–24 and Wave 2.5 remain blocked by external evidence and
  operational approval, not by source implementation status

## Certification status

**ENGINES 1–15 IMPLEMENTED / PRODUCTION CERTIFICATION DEGRADED**

The final framework is executable and fail-closed. Enterprise certification
requires genuine current evidence for every mandatory dashboard domain.
