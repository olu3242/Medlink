# RC1 Component Harmonization Report

Date: 2026-08-01

Branch: `reconcile/rc1-component-harmonization`

Approved integration base: `origin/main` at `6a128667c4ab6a82574ac5113195732300c71c5f`

## Merge summary

The active landing/GA branch was checkpointed, then merged with the approved RC1 main line. Main already contained the merged platform foundation, runtime/workflow convergence, agent governance, WhatsApp webhook, prescription intake, and certification documentation branches. RC2 development and standalone unmerged AI-agent feature branches were evaluated but not promoted.

| Decision | Branches |
| --- | --- |
| Merged through approved main | `agent/track-a-platform-foundation`, `reconcile/rc1-readiness`, `fix/rc1-post-merge-typecheck`, `feat/agent-governance-layer`, `feat/whatsapp-webhook-runtime`, `feat/prescription-intake-runtime`, RC1 certification/docs branches |
| Preserved from active branch | landing page/images, shared UI/AppShell, seven portal layouts, experience contracts, patient timeline/notifications, MVP integration fabric |
| Evaluated, not approved for RC1 merge | `feat/ai-gateway-prompt-registry`, Alice, Agent SDK, Atlas, Clara branches |
| Explicitly excluded | `rc2-development` and RC2 payments/insurance/logistics/EMR scope |

The harmonized delta relative to approved main covers 104 files, approximately 1,130 added lines and 128 removed lines before this report and migration-name reconciliation.

## Conflict decisions

Six content conflicts were resolved manually:

1. `.env.example`: retained the complete provider-neutral template and added the server-only Supabase service-role key without duplicating WhatsApp secrets.
2. CI: retained architecture, operations, coverage, workspace build, deterministic migration recovery, and optional live-database gates; restored coverage artifact upload.
3. Clinical review route: retained the registered `runExperienceApi` boundary while adopting main's shared decision schema and atomic review RPC.
4. Patient API DTOs: harmonized real pharmacy locality with optional computed distance and retained timeline/notification contracts.
5. Patient application: retained main's atomic MAR/review/reservation operations and added tenant-scoped timeline/notification reads.
6. Root scripts: retained specialized certification commands and the non-duplicative `check` pipeline.

## Component and architecture result

- Seven authenticated portals use the single `@medlink/ui` AppShell, navigation, theme, tokens, typography, and primitives.
- Versioned routes execute through the canonical API runtime or registered experience runtime.
- No v1 route directly invokes Supabase persistence or authentication.
- Main's modular conversation and WhatsApp implementations replace the older journey implementation.
- Workflow IDs and event contracts remain owned by the existing workflow/API registries.
- AI work uses the merged agent-governance package and existing governed AI service; unapproved parallel agent stacks were not merged.
- The landing experience and its four image assets were preserved.

## Database harmonization

Five duplicate Supabase version prefixes existed on approved main. The second migration at each collision was assigned a precision suffix (`...01`) while preserving its exact relative execution order:

- `20260729000901_wave2_batch_commits.sql`
- `20260729001001_reserve_inventory.sql`
- `20260729001201_professional_operations.sql`
- `20260729001301_fulfillment_transitions.sql`
- `20260729001401_retire_legacy_reserve_inventory_overload.sql`

No SQL body or historical dependency was reordered. Environments that recorded one of the former duplicate identifiers must compare `supabase_migrations.schema_migrations` and use an operator-approved `supabase migration repair` plan before deployment; this repository does not mutate external migration history automatically.

## Quality evidence

| Gate | Result |
| --- | --- |
| TypeScript | PASS |
| ESLint | PASS |
| Architecture certification | PASS, 8/8 |
| Repository tests | PASS, 586; 8 live-database tests skipped without credentials |
| Migration certification | PASS, 72/72 on Windows and LF/CRLF portable |
| Production builds | PASS for admin, dashboard, developer, patient, pharmacist, pharmacy, provider, and web |
| Tenant isolation | PASS through static RLS matrices and route architecture guards |
| Formatting/conflict markers | PASS |

## Remaining external gates

- Run local/hosted Supabase reset and live database tests with approved credentials.
- Verify existing hosted migration ledger before applying renamed collision migrations.
- Exercise real Meta webhook verification/delivery and private prescription bucket policies.
- Record accessibility, performance, penetration-test, backup/restore, and operational approval evidence in the target deployment environment.
- Review and approve standalone AI feature branches separately before any future merge.
