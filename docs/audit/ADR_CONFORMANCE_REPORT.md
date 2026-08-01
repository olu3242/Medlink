# ADR Conformance Report (Engine 61)

Every file in `docs/adr/` read and cross-referenced by number for this
report -- not sampled.

## ADR inventory

| File | Claimed number | Status | Topic |
| --- | --- | --- | --- |
| `0001-platform-foundation.md` | 0001 | Accepted (amended by ADR 0004's webhook-identity work, PR #6) | Monorepo, Supabase Auth, RLS as final boundary |
| `0002-whatsapp-first-conversation-architecture.md` | 0002 | Superseded by 0003 | Early conversation architecture draft |
| `0003-conversation-driven-architecture.md` | 0003 | Accepted | Conversation-Driven Architecture (CDA) |
| `0004-conversation-runtime-webhook-identity.md` | **0004 (collision)** | Accepted this session (PR #6) | System identity for the WhatsApp webhook |
| `0004-production-operations-framework.md` | **0004 (collision)** | Accepted 2026-07-30 | Deployment/stabilization/support/continuity ownership (Engines 16-20) |
| `0005-dual-ai-ownership-mapping.md` | **0005 (collision)** | Accepted | Two-engineer folder-ownership protocol (Claude/Codex) |
| `0005-enterprise-service-management-platform.md` | **0005 (collision)** | Accepted 2026-07-30 | Service ownership/customer success/admin operating model |
| `0006-wave-transition-framework.md` | 0006 | Not independently re-verified this pass | Wave transition governance |
| `0007-enterprise-platform-evolution-framework.md` | 0007 | Not independently re-verified this pass | Platform evolution framework |

## The numbering collision

Two number values (0004, 0005) are each claimed by two unrelated,
independently-`Accepted` documents. No document in either pair references
the other. This was not caught by any certification pass before this one
-- `RC1_ARCHITECTURE_CONFORMANCE.md` (the prior audit) predates three of
the four colliding documents, and no subsequent document in this
repository's `docs/audit/` directory appears to have cross-referenced
`docs/adr/` by filename number until this report.

**Root cause, inferred from content, not confirmed with the repository
owner**: `0005-dual-ai-ownership-mapping.md` describes a "dual-AI
development protocol" naming two engineers with exclusive folder
ownership and a `docs/HANDOFF.md` escalation path. The most likely
explanation is that ADR numbers were assigned independently within each
engineer's ownership boundary before a merge reconciled the folder
structure but not the numbering sequence. This is offered as the probable
mechanism, not asserted as fact -- the repository owner is the actual
authority on which explanation is correct.

**Why this matters beyond tidiness**: an ADR number is how this
repository's own governance model (`IMPLEMENTATION.md`'s Platform Freeze
Gate, invoked repeatedly this session -- e.g. "requires an accepted ADR
before such a change lands") refers to a specific accepted decision. A
future reference to "ADR 0004" or "ADR 0005" in a PR description, code
comment, or planning document is now genuinely ambiguous without also
naming the file.

## Recommended remediation

Renumber, don't rewrite. Both pairs of documents are independently sound
and already `Accepted` -- there's no decision-content problem here, only
an identifier collision. Recommended:

1. Keep `0004-conversation-runtime-webhook-identity.md` and
   `0005-enterprise-service-management-platform.md` at their numbers (the
   two more recently accepted, both dated 2026-07-30 or this session --
   renumbering the *older* pair minimizes how many existing cross-references
   need updating, since more of this repository's own recent work already
   cites the newer numbers).
2. Renumber `0004-production-operations-framework.md` -> `0008`, and
   `0005-dual-ai-ownership-mapping.md` -> `0009` (the next two available
   numbers after `0007`), or whatever numbers the repository owner
   prefers -- the specific numbers matter less than that they stop
   colliding.
3. Grep the repository for every reference to the old filenames/numbers
   (`docs/audit/RC1_BACKLOG.md`, `docs/audit/CERTIFICATION_GAP.md`, and
   any `docs/runbooks/*.md` this session did not exhaustively check for
   ADR citations) and update them in the same change.
4. This is a documentation-only fix with no code impact -- safe to do
   independent of and without blocking any pilot readiness decision.

**Not done in this pass**: this report identifies and recommends the fix;
it does not perform the rename, since doing so touches files this
program's constituent PRs (#5-#9) did not open and would mix an
unrelated governance-hygiene change into an already-large review surface.
Recommend a dedicated, single-purpose follow-up PR.

## Per-ADR conformance to what was actually built

- **ADR 0001** (platform foundation): conformant, correctly amended by
  PR #6 with the one narrow service-role exception it needed -- no other
  route or PR claims or uses that exception (verified: `grep` for
  service-role client construction outside `apps/web/app/api/whatsapp/webhook`
  finds nothing).
- **ADR 0003** (CDA): conformant, per `ARCHITECTURE_CONFORMANCE_FINAL.md`'s
  Conversation architecture section.
- **ADR 0004 (webhook identity)**: accepted and built exactly as
  specified, including its own documented follow-on limitation
  (service-role callers can't satisfy `auth.uid()` for actor-checked
  RPCs) -- see `WHATSAPP_RUNTIME_CERTIFICATION.md`.
- **ADR 0004 (production operations) / ADR 0005 (enterprise service
  management) / ADR 0005 (dual-AI)**: not independently re-verified
  against current implementation in this pass -- out of this program's
  evidence-gathering scope, flagged as Needs Validation rather than
  assumed conformant.
