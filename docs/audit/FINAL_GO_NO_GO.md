# RC1 Final Go/No-Go (Engine 40)

Date: 2026-08-01. Scope: controlled pilot readiness, evaluated against the
combined state of `main` + PR #5, #6, #7, #8 (all open, unmerged). This
document does not replace `docs/release/rc1-ga/GA_DECISION.md`, which
remains the authority on General Availability and already returns
**NO-GO** for reasons outside repository control (live DR execution,
independent penetration testing, provider conformance, human sign-offs).
This document answers a narrower question: *given everything built and
found across this session's certification program, is a controlled pilot
-- not GA -- supportable today?*

## Decision: NO-GO for pilot, with a short, specific, closable path to reconsider

This is not the same NO-GO as `GA_DECISION.md`'s. That decision is blocked
on items no engineering work in this repository can close (live
infrastructure execution, external audits, human approvals). This
decision is blocked on a smaller number of items that **can** be closed
by continuing this exact program, without new architecture, ADRs, or
scope -- and the path to reconsider is named explicitly below, not left
open-ended.

## Why NO-GO, specifically

1. **No patient journey completes without manual intervention.**
   `WORKFLOW_DEPENDENCY_MATRIX.md`'s chaining-gaps section names three
   specific missing connections (WhatsApp -> prescription workflow,
   upload -> parsing, MAR -> reservation). A pilot needs at least one of
   these closed enough to demonstrate the platform's actual value
   proposition, not just its individual components.
2. **The platform cannot talk back to a patient.** G09 is completely
   unbuilt (zero outbound channels, confirmed independently in three
   separate documents this program produced). A pilot where a patient
   uploads a prescription and never hears anything back is not a
   credible pilot.
3. **Multi-tenant isolation has never been proven under live conditions.**
   All six adversarial scenarios in `MULTITENANT_SECURITY_REPORT.md` are
   Blocked on the identical missing dependency (a live test environment).
   For a healthcare platform handling prescription data across
   pharmacy tenants, this is not a risk to accept for a pilot, controlled
   or not.
4. **The core inventory-reservation race has never been proven under real
   concurrency.** `FAILURE_TEST_MATRIX.md`'s inventory-conflict row: sound
   design, zero live proof. A pilot with even a handful of concurrent
   patients could exercise exactly this race.

## What would change this to GO for a controlled pilot

Every item below is concrete, already-diagnosed by this program's
documents, and does not require new scope beyond what's already been
identified:

1. Provision one live Supabase test environment (`MULTITENANT_SECURITY_REPORT.md`'s
   single recommended action closes items 3 and 4 above at once: run the
   adversarial cross-tenant matrix AND the inventory-conflict concurrency
   test against it).
2. Close one of the three chaining gaps end-to-end -- recommend
   WhatsApp -> WF-003 upload, since PR #6 and #8 already exist and are
   individually certified; connecting them is wiring, not new
   capability.
3. Build the minimum G09 slice: one real `NotificationChannel`
   (WhatsApp, since `GraphApiWhatsAppSender` already exists and is
   tested) plus wiring `OutboxDispatcher` to at least one real event.
4. Rotate the two historical leaked credentials (independent of the above,
   should happen regardless of pilot timing).

None of these four items requires inventing new architecture -- all four
are extensions of work already certified in this program.

## What does NOT need to happen before a pilot (explicitly, to avoid scope creep)

- OCR. `PRESCRIPTION_INTAKE_CERTIFICATION.md` already establishes the
  workflow functions with pharmacist review of the stored image alone.
- The `needs_information` clarification round-trip. Real gap, but a
  pilot can operate with binary approve/reject initially if pharmacists
  are briefed on the limitation.
- `clinical_findings` immutability. Real gap, low urgency for a
  controlled pilot with a small, trusted pharmacist cohort; should still
  be fixed before wider rollout.
- Full G09 (email/SMS channels, all six notification types). One
  WhatsApp-only slice is sufficient for a pilot.
- Anything `GA_DECISION.md` already lists as GA-specific (managed
  backup/DR exercises, independent pen test, provider conformance, human
  sign-offs) -- those remain correctly out of scope for a pilot decision
  and stay owned by that document.

## Evidence index

Every claim in this document traces to a specific, cited document
produced in this session's certification program:

- `docs/audit/WORKFLOW_CATALOG.md`
- `docs/audit/WORKFLOW_DEPENDENCY_MATRIX.md`
- `docs/audit/WORKFLOW_CERTIFICATION.md`
- `docs/audit/FAILURE_TEST_MATRIX.md`
- `docs/audit/CLINICAL_SAFETY_CERTIFICATION.md`
- `docs/audit/MULTITENANT_SECURITY_REPORT.md`
- `docs/audit/PILOT_SIMULATION_RESULTS.md`
- `docs/audit/RC1_PILOT_READINESS.md`
- `docs/audit/LAUNCH_GAP_MATRIX.md` (prior round)
- `docs/audit/WHATSAPP_RUNTIME_CERTIFICATION.md`,
  `docs/audit/PRESCRIPTION_INTAKE_CERTIFICATION.md`,
  `docs/audit/AGENT_GOVERNANCE_LAYER.md` (prior rounds)
- `docs/release/rc1-ga/GA_DECISION.md` (authoritative for GA, unaffected
  by this document)

No claim in this document or any document it cites asserts a PASS without
a specific test, migration, or command backing it. Every Blocked item
names its exact missing dependency and the minimal action to close it.
