# Network transaction convergence report

Date: 2026-08-18
Branch: `feat/network-transaction-convergence`

## Authority and transaction result

- B1 cross-organization discovery: PASS. An authenticated patient with explicit location consent calls a narrow `SECURITY DEFINER` marketplace projection. Ordinary tenant RLS remains intact and raw pharmacy records are neither granted nor returned.
- Medication continuity: PASS. Canonical medicine identity flows from discovery through reviewed MAR, match, inventory lock, and reservation.
- Price continuity: PASS. Discovery showed 2,500 NGN; inventory changed to 2,600 NGN; reservation payment used the current authoritative 2,600 NGN value.
- Partner-generated pharmacy loop: PASS through Partner application, approval, agreement, activation, governed source readiness, unrelated patient discovery, reservation, captured payment, READY, and COLLECTED.

## Same-transaction restart

The certification commits one captured-payment transaction, records its patient organization, pharmacy organization, location, inventory, medicine, reservation, payment, provider reference, and correlation identity, then exits the original database client. A fresh Node worker process resumes the same reservation through READY and COLLECTED.

Replay evidence after restart: one reservation, one payment, zero active locks, one consumed lock, one collected fulfillment transition, and one READY outbox event. The reservation and payment IDs before and after restart are identical.

## Multi-pharmacy measurement

The deterministic fixture exercises three distinct pharmacy organizations and locations. Pharmacy A is the Partner-generated exact offering, Pharmacy B is an eligible generic offering, and Pharmacy C is excluded because its location is inactive.

Measured certification result: 3 candidates, 2 eligible, 1 excluded, 2 returned. EXACT, GENERIC, BOTH, and NONE outcomes are asserted through bounded queries. An identical repeated query returns the same inventory IDs, relationships, and defined distance ordering. Query duration is emitted by each live run; no scale claim is made beyond these three pharmacies.

## Partner browser boundary

PASS. Playwright completes application, review, approval, agreement, integration certification, location readiness, and activation. Privileged persistence setup uses a service-role-only certification RPC from the Node harness. The browser receives no service credential and production table grants are unchanged.

## Security

Missing, invalid, and cross-organization-forged consent is denied. Stale inventory, suspended Partners, inactive locations, insufficient availability, and out-of-radius offerings are excluded. An authenticated patient can use the minimized projection but cannot select Partner records or raw cross-tenant inventory and cannot mutate pharmacy price.

## Backup and recovery governance

An isolated local auth/public dump restore completed with zero restore errors and preserved representative Partner, location, inventory, collected reservation, captured payment, collected fulfillment, and audit invariants. This is local technical evidence only.

Production RPO, RTO, retention, backup frequency, PITR, restore ownership, and test cadence remain `OWNER_POLICY_BLOCKED`; see `BACKUP_RECOVERY_POLICY_DECISION.md`.

## Final regression

- Canonical: 1,022 passed, 44 skipped, 0 failed across 189 passing and 10 skipped files.
- Live database: 25/25 passed across four files.
- Security: 88/88 passed.
- Recovery: 25/25 passed.
- Provider conformance: 14/14 passed.
- Auth browser: 9/9 passed.
- Partner browser: 1/1 passed.
- WhatsApp golden loop: 1/1 passed, 15 phases, 36,978 ms.
- Payment-refund browser: 1/1 passed.
- Partner/database convergence pair: 2/2 passed.
- Migration replay and database reset through migration 073: passed.
- Application builds: 8/8 passed.
- Lint and typecheck: passed.

## Verdict rule

B1, B3, B4, and H1 are technically closed. Final merge readiness remains conditional on the complete canonical regression recorded in the PR. No RC1, release, production promotion, or merge is authorized by this report.
