# RC2 Early Development Authorization

Authorization date: 2026-07-30  
Status: **AUTHORIZED WITH RELEASE ISOLATION**  
RC2 branch: `rc2-development`  
Parent tag: `v1.0.0-rc1`  
Parent commit: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`

## Authorization

The program authority explicitly authorized creation of an RC2 development
branch before RC1 General Availability, while keeping RC1 frozen and
prohibiting RC2 changes from merging into RC1.

This is a narrow exception to the earlier RC2 admission rule. It authorizes
future development in isolation; it does not change the RC1 GA decision.

## Program state

```text
RC1 engineering                 COMPLETE
RC1 technical certification    COMPLETE
RC1 operational validation     IN PROGRESS
RC1 General Availability       NO-GO
RC1 engineering freeze         ACTIVE
RC2 branch                     AUTHORIZED
RC2 development                AUTHORIZED IN ISOLATION
RC2 production promotion       BLOCKED UNTIL ITS OWN GATES PASS
```

## Branch boundaries

### RC1

RC1 remains immutable except for:

- Critical security or production-blocking fixes
- Approved operational evidence incorporation
- Approved release-governance documentation

No RC2 feature, schema, API, dependency, AI, workflow, or engine change may be
merged or cherry-picked into the RC1 release candidate.

### RC2

RC2 may contain:

- Engines 36–40
- Their governed APIs, events, migrations, agents, workflows, UIs, tests,
  runbooks, and certification evidence
- Approved platform changes required by RC2

Every RC2 change must preserve RC1 regression coverage and follow the existing
runtime, security, tenant-isolation, AI-governance, observability, recovery, and
certification contracts.

### Research

Research remains non-production and must not bypass RC2 architecture review,
contract governance, security review, or certification.

## Merge and promotion controls

1. Protect RC1 branches and tags from RC2 merges.
2. Require pull requests and mandatory CI for RC2.
3. Reject any pull request targeting RC1 that contains RC2 engine identifiers,
   migrations, APIs, events, agents, or features.
4. Record the RC1 parent tag on RC2 release artifacts.
5. Treat later RC1 emergency fixes as controlled forward-port candidates; they
   require compatibility and regression review before entering RC2.
6. RC2 development authorization does not authorize deployment or GA.

## Initial implementation scope

- Engine 36: Clinical Intelligence Engine
- Engine 37: National Interoperability Engine
- Engine 38: Population Health and Epidemiology Engine
- Engine 39: Healthcare Intelligence Platform
- Engine 40: Autonomous Healthcare Operations Engine

Implementation must proceed through approved engine specifications and stage
gates. This record does not declare any engine implemented or certified.
