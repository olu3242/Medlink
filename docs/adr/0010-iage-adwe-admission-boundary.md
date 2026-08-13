# ADR-0010 — IAGE and ADWE Admission Boundary

Status: Proposed; not admitted for implementation  
Date: 2026-07-30  
Release: RC2

## Context

The proposed Identity, Access & Governance Engine (`MDL-ENG-024`) and Adaptive
Dashboard & Workspace Engine (`MDL-ENG-025`) would make centralized
authorization and permission-filtered presentation dependencies of every
future capability. That dependency direction is sound.

The complete proposal also introduces personas outside the MVP Constitution,
ABAC policy administration, delegation, temporary and break-glass access,
device/geographic controls, configurable widgets and layouts, executive
analytics, autonomous AI assistants, and offline dashboard caching. These are
new capabilities rather than implementation details.

## Decision

RC2 preserves and strengthens the compatible foundation:

- `@medlink/platform` remains the only roles/permissions authorization owner.
- `runApi` remains the authenticated tenant context and API policy boundary.
- PostgreSQL RLS remains the final data-isolation authority.
- Applications must derive navigation, actions, and data visibility from the
  same permission contracts; they may not create local authorization systems.
- AI-assisted ARC tasks inherit the caller's tenant, actor, permission, policy,
  audit, and human-approval boundaries.

`MDL-ENG-024` and `MDL-ENG-025` are not activated by this ADR. Their expanded
capabilities require a separate constitutional scope-admission decision.

## Deferred scope

- New personas such as physician, hospital administrator, inspector, and
  supplier.
- Multiple assignable roles per membership and a general ABAC designer.
- Delegation, temporary access, break-glass access, device trust, and
  geographic authorization.
- User-composable dashboards, widgets, saved layouts, KPI/analytics engines,
  command palettes, calendar integration, and offline cache.
- Persona copilots, executive recommendations, autonomous planning, or any AI
  surface outside deterministic ARC contracts.

## North Star and delivery assessment

Centralized authorization reduces cross-tenant and clinical safety risk for
the prescription-fulfillment journey. The deferred features do not directly
close the current fulfillment gaps and would materially expand schema, API,
UI, security, testing, and certification scope. Activating them before the
approved vertical slice is complete would delay the North Star and invalidate
the current execution boundary.

## Admission requirements

Acceptance requires Product Owner approval, architecture and security review,
explicit persona amendments to the MVP Constitution, data/API contracts,
threat modeling, migration and rollback plans, pilot value metrics, and
certification criteria. Until then, this proposal is non-executable.

## Consequences

Current RC2 delivery continues against the approved personas and capabilities.
No feature may bypass centralized permission checks or RLS. Future admission
can add richer identity governance and workspace composition without replacing
the existing runtime or weakening deterministic ARC behavior.
