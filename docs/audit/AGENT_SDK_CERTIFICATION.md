# Agent SDK Certification (AGSDK, Narrow Scope)

Date: 2026-08-01. Scope: the narrow Agent SDK explicitly chosen over the
originating superprompt's full 15-engine "MAOS Phase 2" specification --
per the user's own selection between three offered options, given that
only one concrete agent (Alice) existed to generalize from.

## Why narrow, not the full 15 engines

The full specification asked for `BaseAgent`, `AgentContext`,
`AgentRequest`, `AgentResponse`, a Capability Framework, a Guardrail
Framework, a Policy Engine, Telemetry, Memory, a Certification Framework,
a new `AgentRegistry`, an SDK Testing Framework, a refactor of Alice, an
Atlas skeleton, and 10 documentation files -- all generalized from exactly
one real agent. Two concrete risks were raised before starting and
confirmed by the user's choice:

1. **Abstracting from a sample size of one.** A `BaseAgent` class "every
   future agent must inherit," designed before a second real agent (not a
   compile-only skeleton) exists to prove the boundary, risks locking in
   a shape that does not fit Atlas's real needs (external medicine data,
   semantic search) once they are actually built.
2. **A competing registry.** The specified `AgentRegistry` (name, version,
   capabilities, status, owner, dependencies, certification, prompt set,
   allowed models, MCP tools) substantially overlaps with the registry
   that already existed in `packages/agents/src/registry.ts`
   (`AgentIdentity`/`AgentCapability`/`governedAgentCatalog`). Building a
   second one would repeat the exact duplicate-component pattern this
   program has avoided elsewhere (choosing to extend `packages/ai` rather
   than create a competing `packages/ai-gateway`, for the identical
   reason).

## What was built

- **`packages/agents/src/agent-runtime.ts`** -- `invokeGovernedCapability()`,
  a reusable **function** (not a forced base class) extracting the one
  pattern Alice's real code has now proven: authorize capability -> optional
  input guardrail -> AI Gateway invocation -> optional output guardrail.
  Both `AliceAgent` and `AtlasAgent` call it; neither inherits from
  anything. `AgentCapabilityDeniedError` is the shared denial error,
  replacing Alice's own `AliceCapabilityDeniedError`.
- **`packages/agents/src/registry.ts` extended, not duplicated** -- three
  new optional fields on `AgentIdentity`: `version`, `owner`, `promptIds`.
  Optional so the pre-existing catalog entries that don't set them remain
  valid. Populated for real for both Alice and Atlas. Deliberately does
  **not** add `dependencies`, `certification`, `allowedModels`, or
  `supportedMcpTools` fields -- none has real data to populate yet (no MCP
  server exists anywhere in this repository, no per-agent model
  restriction exists beyond the Gateway's own route configuration, no
  separate certification-artifact reference format is established).
  Adding empty, aspirational fields now would be exactly the kind of
  speculative field this pass was scoped to avoid.
- **`AliceAgent` refactored** onto `invokeGovernedCapability()`. Her own
  guardrail predicates and her own two-reason escalation mapping stay in
  `alice.ts`, because that mapping is genuinely agent-specific -- Atlas,
  per its own original spec ("Atlas never approves substitutions"), needs
  no escalation semantics at all. Forcing every agent through the same
  escalation shape in the shared helper would itself have been a
  premature generalization. Alice's behavior is unchanged; her existing
  10 tests pass unmodified except for the renamed error class.
- **`packages/agents/src/atlas.ts` -- `AtlasAgent` skeleton (AGSDK-14)**.
  Real wiring: a real `governedAgentCatalog` entry, a real registered
  prompt (`atlas_normalize_medicine_name`), a real `AIGateway` call
  through the same shared helper Alice uses. Zero real medicine
  intelligence -- the prompt template says explicitly "this is a
  placeholder prompt that proves Agent SDK wiring only." This is the
  Definition of Done's literal ask: "Atlas compiles using the SDK."

## What this substitutes for, honestly

| Requested (full spec) | What actually exists instead |
| --- | --- |
| `BaseAgent` class, inherited by every agent | `invokeGovernedCapability()`, a composable function both agents call |
| `AgentContext` | The existing `RuntimeContext` (`@medlink/runtime`), unchanged -- already carries tenant/role/correlation/session concerns |
| `AgentRequest`/`AgentResponse` | Each agent's own request/response types (`AliceRequest`/`AliceResponse`, `AtlasRequest`/`AtlasAnswer`) -- not unified, because their shapes genuinely differ (Alice has escalation; Atlas does not) |
| Capability Framework | The existing `AgentCapability`/`governedAgentCatalog` (predates this pass), unchanged |
| Guardrail Framework | Alice's own `alice-guardrail.ts` heuristics, invoked through `invokeGovernedCapability`'s generic `checkInput`/`checkOutput` hooks -- not a separate reusable guardrail library, since Atlas has none to reuse yet |
| Policy Engine | The existing `authorizeAgentCapability()` (predates this pass), unchanged, called from inside the shared helper |
| Telemetry | `AIGateway`'s existing `AIGatewayTelemetrySink` port (predates this pass) -- still not wired to a concrete sink by any agent |
| Memory | Not touched. `AgentMemoryBoundary` (predates this pass) remains declarative only |
| Certification Framework | This document, written by hand, the same way every other engine in this program has been certified |
| `AgentRegistry` | The existing registry, extended with 3 optional fields (see above) |
| SDK Testing Framework | Not built -- each agent still writes its own tests; `agent-runtime.test.ts` covers the one shared function directly |
| 10 documentation files | This one document |

## Test evidence

8 new tests: `agent-runtime.test.ts` (5, covering the answer path,
authorization denial, both guardrail trip paths, and no-guardrails-
configured), `atlas.test.ts` (3, covering successful SDK wiring end to end
and role denial). Alice's existing 10 tests pass unmodified (behavior
identical after the refactor). Full repository `npm run check`: 661
passed, 8 skipped (live-DB only, unrelated), 0 failed -- up from 653
before this pass.

## Deliberately out of scope (unchanged from the full spec's list)

Quinn orchestration, Clara clinical reasoning, Nova inventory
intelligence, Sage RAG, Echo communication orchestration, Sentinel
security intelligence, Orion operational intelligence, Ledger compliance
intelligence -- none built, matching the originating superprompt's own
"RC1 Completion Rule" explicitly excluding all of these regardless of
which SDK-scope option was chosen.

## Relationship to RC1 pilot readiness

Additive and orthogonal, same as every other AI Platform document in this
program -- does not close any of the four items `GO_NO_GO_SUMMARY.md`
names. The RC1 pilot verdict is unchanged.
