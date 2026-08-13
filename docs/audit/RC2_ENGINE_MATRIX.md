# RC2 E2E Engine Matrix

Date: 2026-07-31

Status vocabulary is restricted to `COMPLETE`, `PARTIAL`, `MISSING`, `BLOCKED`,
and `DEFERRED`. `BLOCKED` is used when source exists but required live/provider
evidence cannot run. `COMPLETE` means executable evidence exists for that
column; it does not imply overall certification.

| Engine / capability | Business | UI | API | DB | Workflow | Events | Agent | AI | Security | RLS | Observability | Recovery | Tests | Docs | E2E Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ML-CAP-001 Identity & Access | COMPLETE | PARTIAL | COMPLETE | COMPLETE | PARTIAL | PARTIAL | DEFERRED | DEFERRED | COMPLETE | BLOCKED | PARTIAL | PARTIAL | PARTIAL | COMPLETE | PARTIAL |
| ML-CAP-002 Patient Management | COMPLETE | COMPLETE | COMPLETE | COMPLETE | PARTIAL | PARTIAL | DEFERRED | DEFERRED | COMPLETE | BLOCKED | COMPLETE | PARTIAL | PARTIAL | COMPLETE | PARTIAL |
| ML-CAP-003 Pharmacy Management | PARTIAL | PARTIAL | PARTIAL | COMPLETE | MISSING | MISSING | DEFERRED | DEFERRED | PARTIAL | BLOCKED | PARTIAL | MISSING | PARTIAL | PARTIAL | PARTIAL |
| ML-CAP-004 Pharmacist Management | PARTIAL | PARTIAL | PARTIAL | COMPLETE | PARTIAL | PARTIAL | DEFERRED | DEFERRED | COMPLETE | BLOCKED | COMPLETE | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| ML-CAP-005 Medicine Catalogue | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | DEFERRED | DEFERRED | COMPLETE | BLOCKED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | BLOCKED |
| ML-CAP-006 Prescription Intake / ML-ENG-006 | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | PARTIAL | COMPLETE | BLOCKED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | BLOCKED |
| ML-CAP-007 Clinical Review / ML-ENG-007 | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | DEFERRED | DEFERRED | COMPLETE | BLOCKED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | BLOCKED |
| ML-CAP-008 Pharmacy Inventory | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | DEFERRED | DEFERRED | COMPLETE | BLOCKED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | BLOCKED |
| ML-CAP-009 Medicine Search | PARTIAL | PARTIAL | PARTIAL | COMPLETE | PARTIAL | MISSING | DEFERRED | DEFERRED | PARTIAL | BLOCKED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| ML-CAP-010 Reservation & Pickup | PARTIAL | PARTIAL | PARTIAL | COMPLETE | PARTIAL | PARTIAL | DEFERRED | DEFERRED | PARTIAL | BLOCKED | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| ML-CAP-011 Conversation / WhatsApp | PARTIAL | MISSING | MISSING | COMPLETE | PARTIAL | PARTIAL | DEFERRED | DEFERRED | PARTIAL | BLOCKED | MISSING | PARTIAL | PARTIAL | PARTIAL | MISSING |
| ML-CAP-012 Administration | PARTIAL | PARTIAL | PARTIAL | PARTIAL | MISSING | PARTIAL | DEFERRED | DEFERRED | PARTIAL | BLOCKED | PARTIAL | MISSING | PARTIAL | PARTIAL | PARTIAL |
| Deterministic ARC / ML-ENG-013 use | COMPLETE | DEFERRED | DEFERRED | DEFERRED | COMPLETE | PARTIAL | COMPLETE | COMPLETE | COMPLETE | DEFERRED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| Enterprise Runtime | COMPLETE | PARTIAL | COMPLETE | COMPLETE | PARTIAL | COMPLETE | DEFERRED | DEFERRED | COMPLETE | BLOCKED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | PARTIAL |

## Discovered historical or deferred areas

| Area | Repository evidence | E2E status | Disposition |
| --- | --- | --- | --- |
| Medication Access Request | schema, direct application queries, UI | PARTIAL | Retain as Golden Path coordination object; close through approved workflows |
| Notifications | tables and small idempotency service | PARTIAL | P1 dependency of reservation/WhatsApp |
| Payment | tables and provider port only | DEFERRED | Not required by the MVP Constitution |
| Adherence | small service and dashboard scaffold | DEFERRED | Post-Golden-Path |
| Analytics/reporting | suppression and governance primitives | DEFERRED | Only pilot operational metrics may be admitted later |
| Partner integrations/developer portal | extension contracts and UI scaffolds | DEFERRED | FHIR/HL7/HMO and broad partner scope prohibited for this MVP |
| Provider portal | UI scaffold and role remnants | DEFERRED | Provider is not an approved MVP persona |
| Enterprise governance/certification/operations | extensive source-level control packages | PARTIAL | Reusable control plane; external operational evidence remains outside source |
| MDL-ENG-024/025 | proposed ADR-0010 only | DEFERRED | Not admitted for implementation |
| Engines 36-40 | governance references only | DEFERRED | Explicitly prohibited by ADR-0008 |

No active business engine is currently production-certified because the live
RC2 migration and authenticated RLS boundary is blocked.
