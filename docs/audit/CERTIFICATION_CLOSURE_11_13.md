# RC1 Certification Closure — Gates 11–13

Date: 2026-07-29

## Stage 1 — External conformance artifacts

OCR, WhatsApp, payment, FHIR, HL7, and approved-partner evidence is accepted
only when it is external, current, unique by integration/profile/environment,
and its content matches the declared SHA-256 digest.

## Stage 2 — Signed approvals

Clinical, privacy, security, and operations approvals are independently
required. Each approval is Ed25519-verified through a key boundary, bound to an
evidence hash, time-bounded, and stored in an append-only tenant-RLS table.

## Stage 3 — API and Conversation profiles

API and Conversation runtime evidence must independently demonstrate their
required Enterprise Runtime capabilities. Conversation additionally requires
human escalation.

## Stage 4 — Background and AI profiles

Background evidence omits interactive-authentication requirements while
retaining tenant, telemetry, health, evidence, and idempotency controls. AI
evidence independently requires human escalation.

## Stage 5 — Administrative profile and release decision

Administrative evidence cannot borrow another profile's artifact. The release
decision is approved only with all mandatory and conditional gates satisfied,
conditional while legitimate external inputs are pending, and rejected when a
mandatory control fails.

## Current decision

Source controls: **PASS**, subject to consolidated validation.

Release status: **CONDITIONAL**. No provider report, human approval signature,
or deployed-environment runtime artifact has been fabricated. Those artifacts,
plus the outstanding environment exercises, are required for approval.
