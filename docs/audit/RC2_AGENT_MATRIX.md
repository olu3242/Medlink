# RC2 Agent and ARC Matrix

The repository contains deterministic ARC tasks and an older advisory AI
service. It contains no accepted named Agentic OS, MAOS, MAIF, Alice, Quinn, or
autonomous multi-agent implementation. Names from prior prompts are not
repository evidence and are not introduced by this audit.

| Identity | Responsibility | Inputs / tools | Output | Memory / delegation | Approval boundary | Audit / telemetry | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `AgentTaskExecutor` | Apply MVP policy and execute one bounded task | typed task callback | completed output, human-review result, or denial | none / none | policy fails closed | `AgentTaskObserver` lifecycle records | COMPLETE |
| File scan task | Scan uploaded prescription before storage | media bytes to configured scanner HTTP endpoint | clean/rejected evidence | none / none | cannot accept clinical content | ARC telemetry plus intake evidence | BLOCKED |
| OCR task (`ML-ENG-013` usage) | Extract bounded prescription text | protected file, OCR HTTP provider | typed OCR result with confidence/provenance | none / none | no clinical transition | ARC telemetry; database completion writes event/evidence | BLOCKED |
| Parsing task (`ML-ENG-013` usage) | Convert OCR text to bounded structure | OCR result, parser HTTP provider | typed prescription structure | none / none | pharmacist review remains mandatory | ARC telemetry; atomic stage evidence | BLOCKED |
| Deterministic quality validator | Flag ambiguity and low confidence | structured prescription | immutable findings | none / none | cannot decide prescription | workflow/outbox/audit in completion RPC | COMPLETE |
| Pharmacist decision command | Human clinical authority; not an agent | authenticated review, acknowledgements and explicit canonical item resolutions | approved/rejected/needs-information | none / none | verified active pharmacist only; approval fails closed on unresolved items | immutable resolution/decision/audit/outbox | BLOCKED |
| Legacy `AgentOrchestrator` | Advisory confidence wrapper for six agent kinds | typed in-memory agent and threshold | recommendation or escalation | no durable memory / none | always human-reviewed; cannot transition MAR | audit sink contract | PARTIAL |

## ARC policy

Allowed task actions are `file_scan`, `ocr`, `prescription_parse`, and
`clinical_warning`. Generic substitution, clinical recommendation,
prescription approval, and clarification resolution return
`pending_human_review`. Unknown and cross-tenant actions are denied.

## Certification gaps

- Provider-backed scan/OCR/parser execution and failure recovery are unavailable.
- ARC telemetry is structured logging, not a durable agent-specific evidence
  projection.
- The older `@medlink/ai` catalog is not wired into the Golden Path and cannot
  be counted as a production agent.
- No implementation may add planning, autonomy, generalized memory,
  delegation, or named-agent architecture without constitutional admission
  and a new accepted ADR.
