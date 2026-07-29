# RC1 Certification Closure — Gates 6–10

Date: 2026-07-29

## Gate 6 — WhatsApp patient journey

The journey verifies the provider signature, atomically claims the provider
message, hashes channel identity, checks consent, downloads media, routes
intent, triggers human handoff, and sends an idempotent response. Its test does
not import or call a web application.

## Gate 7 — Professional portal RBAC

Every declared professional API operation is tested against every declared
portal role and the central permission matrix. Patient roles are excluded from
the professional operation catalog.

## Gate 8 — Observability and incident evidence

Operational alerts are persisted with severity, correlation ID, trace ID,
metric snapshot, timestamp, and repository-owned runbook.

## Gate 9 — Security assurance

- The threat model documents assets, boundaries, threats, controls, and
  release-blocking conditions.
- Source assurance detects embedded secrets, private keys, and insecure
  external HTTP endpoints.
- High and critical production advisories are release-blocking inputs.
- A live npm-registry audit was not performed because external transmission of
  the dependency manifest was not authorized in this session.

## Gate 10 — Exercise reports

The report records the local runtime performance baseline and distinguishes it
from pending authorized penetration, managed backup, isolated restore, and
disaster-recovery exercises. No environment exercise is represented as passed.

## Status

Source certification: **PASS**, subject to consolidated validation.

Runtime certification remains conditional on configured WhatsApp delivery,
deployed portal E2E, an authorized dependency audit and penetration test, and
real backup/restore/DR artifacts.
