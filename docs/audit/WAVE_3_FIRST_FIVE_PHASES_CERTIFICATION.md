# Wave 3 — First Five Phases Certification

Date: 2026-07-29

## Scope

This record covers RC1 backlog items 14–18:

1. Conversation Engine boundaries and persistence.
2. WhatsApp signature, payload, media, identity, consent, and delivery ports.
3. Durable orchestration and the canonical workflow catalog.
4. Transactional outbox consumer dispatch, retry, and dead-letter behavior.
5. MAR and Reservation state vocabulary reconciliation.

## Evidence

- Conversation sessions, immutable messages, provider-message deduplication,
  consent state, and human-handoff persistence are defined under tenant RLS.
- The WhatsApp boundary verifies HMAC signatures and normalizes inbound text
  and media without coupling the conversation domain to a provider SDK.
- Workflow instances resume from completed durable steps; all WF-001–WF-015
  identifiers remain represented in the canonical catalog.
- Outbox dispatch publishes successful events, delays retryable failures with
  exponential backoff, and dead-letters missing or exhausted consumers.
- Package-level MAR and Reservation states now match the database vocabulary.

## Automated result

- `npm run check`: passed.
- `npm run test:coverage`: passed.
- 97 tests passed; one credential-gated live-database test was skipped.

## Certification status

Source certification: **PASS**.

Final runtime certification remains conditional on applying the migrations to
the target Supabase environment, exercising tenant RLS, and capturing delivery
receipts from a configured WhatsApp provider.
