# AI Integration

All RC1 agents execute through `AgentOrchestrator` and the configured governed provider. Each output is advisory, confidence-scored, recorded, and requires human review; it cannot transition medication-access state or make a clinical decision. `AI_PROVIDER=disabled` is the safe default. Provider activation also requires `AI_API_KEY` and an approved `AI_MODEL`. Direct model SDK access from applications is prohibited.
