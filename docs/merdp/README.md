# MERDP Architecture Set

## Authority hierarchy

| Level | Artifact | Authority |
| --- | --- | --- |
| 1 | [MERDP Constitution](../REFERENCE_DATA_PLATFORM_CONSTITUTION.md) | Mission, boundaries, invariants, and engine topology |
| 2 | [Engine Contract Framework](ENGINE_CONTRACT_FRAMEWORK.md) | Universal execution and interoperability contract |
| 2 | [Canonical Reference Data Dictionary](CANONICAL_REFERENCE_DATA_DICTIONARY.md) | Entity and attribute semantics |
| 2 | [Enterprise Transformation Rule Catalog](ENTERPRISE_TRANSFORMATION_RULE_CATALOG.md) | Declarative transformation governance |
| 2 | [Entity Resolution Playbook](ENTITY_RESOLUTION_PLAYBOOK.md) | Identity, match, merge, and survivorship policy |
| 2 | [Reference Lifecycle Specification](REFERENCE_LIFECYCLE_SPECIFICATION.md) | State transitions and actor authority |
| 2 | [Reference Event Contract](REFERENCE_EVENT_CONTRACT.md) | Durable event envelopes and delivery semantics |
| 3 | Engine 01–20 specifications | Per-engine implementation contracts and certification suites |
| 4 | Wave delivery plans | Sequencing, rollout, evidence, and operational acceptance |

## Change control

The Constitution is frozen at architecture version 1.0.0. Level 2 documents
may clarify implementation behavior but MUST NOT introduce a new platform
boundary or weaken a constitutional invariant. Such changes require an ADR and
architecture-version change.

Conflicts resolve in this order: Constitution, Enterprise Runtime Contract,
Level 2 MERDP contracts, approved engine specification, implementation. A
conflict is never silently resolved in code.

## Capability maturity

| Level | Name | Required evidence |
| --- | --- | --- |
| 1 | Managed | Governed ingestion, validation, certification, and publication |
| 2 | Standardized | Canonical model, versioning, MDM, and reversible identity decisions |
| 3 | Connected | Governed graph relationships and event-driven synchronization |
| 4 | Intelligent | Evaluated AI assistance, automated quality analysis, continuous synchronization |
| 5 | Adaptive | Policy-bounded recovery and rule recommendations with human governance |

“Autonomous” does not mean autonomous clinical authority. At every maturity
level, clinical certification and safety-significant decisions remain with
qualified humans.

Wave 1 targets Level 1, Wave 2 targets Level 2, Wave 3 targets Level 3, and
Wave 4 may target selected Level 4 capabilities. Level 5 requires separate
authorization and is not an MVP commitment.
