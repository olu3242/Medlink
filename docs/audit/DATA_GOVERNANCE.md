# Data Governance (Engine 66)

## Data ownership

Every tenant-scoped table is owned by its migration's domain (platform
core, clinical intelligence, medication access, conversation engine,
agent governance, etc. -- see `WORKFLOW_DEPENDENCY_MATRIX.md` and
`ENGINEERING_GOVERNANCE.md` for the package-level mapping). Ownership is
structural (RLS + `organization_id`), not documented in a separate data
dictionary. `packages/medicine`'s domain models are the closest thing
this repository has to a canonical data dictionary for clinical entities.

## Master data quality

- **Medicine catalog**: `generics` (first-class table since Wave 2,
  backfilled and kept in sync via trigger, not a duplicated write path)
  and `medicines` are the master sources; `normalizeMedicineName()`
  provides consistent normalization for matching. No production-scale
  data-quality report exists (`ENGINE_STATUS_MATRIX.md`'s Search row:
  "no production-scale index evidence") -- this repository has never
  been evaluated against a real, populated catalog at pilot scale.
- **Prescription/patient data**: `prescriptions` now has real
  checksum-based duplicate detection (PR #8) at the tenant boundary --
  the first real data-quality control on this entity beyond schema
  constraints.
- **No master data steward or reconciliation process** is documented
  anywhere in this repository -- expected for a pre-pilot platform with
  no live data yet, flagged as a pilot-scale, not RC1-code, question.

## Audit retention

`retention_policies` and `retention_executions` tables exist (migration
`202607270005`), both RLS-protected, the latter append-only-guarded --
real schema-level infrastructure for retention policy *execution
tracking*. **Not evidenced**: any actual retention policy configured, or
any execution having run. This is infrastructure built ahead of policy
decisions, the same pattern this repository uses elsewhere (e.g.
`packages/notifications` built ahead of any channel implementation) --
sound engineering sequencing, not a gap in the code itself.

## Backup strategy

**Not certified.** `docs/release/rc1-ga/DR_CERTIFICATION.md`'s own
verdict stands unchanged: deterministic schema reconstruction is proven
(byte-identical across two resets); managed encrypted backup,
point-in-time recovery, and isolated data restore all have zero
execution evidence. This document does not re-audit that finding, it
confirms no PR in this program touched backup tooling and the finding is
therefore still current.

## Recovery procedures

Same status as backup strategy -- `DR_CERTIFICATION.md`'s "Missing
mandatory evidence" table (PITR, tenant recovery, configuration/secret
recovery, regional failover, provider outage recovery, RTO/RPO approval)
is unchanged. `docs/runbooks/dependency-outage.md`/`queue-backlog.md`
name recovery *triggers* but not recovery *procedures* at the depth
`OPERATIONAL_GOVERNANCE.md` already characterizes as skeletal.

## Data lifecycle

The one genuinely new data-lifecycle finding from this session:
**prescription image files have no deletion or retention policy.**
`PRESCRIPTION_INTAKE_CERTIFICATION.md`'s own "still open" table names
this explicitly -- the storage bucket built this session (PR #8) has no
automated sweep, and the RLS design deliberately has no delete policy at
all (immutability was the correct choice for the *audit* concern; it
means deletion, when eventually needed for a retention policy or a
patient's deletion request, will need a distinct, deliberately-scoped
service-role-only path, not a relaxation of the existing RLS).

## Assumptions requiring a policy decision before broader rollout

1. **How long is a prescription image retained, and under whose
   authority can it be deleted?** No answer exists in code or policy
   today. `storage.objects` has no delete policy for any authenticated
   role -- correct for now, but the eventual deletion mechanism (service
   role, triggered by an explicit retention job) needs to be designed
   deliberately, not bolted on.
2. **Data subject deletion requests** (a patient asking for their data to
   be removed): no mechanism exists anywhere in this codebase. This is a
   policy and likely legal question (jurisdiction-dependent) before it's
   an engineering one -- flagged, not answered, here.
3. **Cross-border data residency**: not evaluated in this pass; this
   repository's Supabase configuration and hosting region are outside
   what a source-code audit can certify.

## Verdict

Data governance infrastructure (RLS, retention-tracking tables,
append-only audit trails, checksum-based deduplication) is real and
well-built. Data governance *policy* (retention periods, deletion
authority, backup/DR execution) remains entirely undecided or
unexecuted -- consistent with, and not worsened by, this session's PRs.
The one new, concrete finding is the prescription-image retention gap,
now explicitly named rather than implicit in "no policy exists yet."
