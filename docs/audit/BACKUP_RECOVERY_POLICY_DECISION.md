# Backup and recovery policy decision required

Date: 2026-08-18
Status: `BACKUP_RECOVERY_POLICY_DECISION_REQUIRED`

## Technically observed

- MedLink's database authority is Supabase Postgres.
- The repository supports deterministic migration replay and local database reset.
- A local PostgreSQL custom-format dump of the `auth` and `public` schemas was restored into an isolated database with zero restore errors on 2026-08-18.
- The restored database preserved a Partner relationship, pharmacy location, inventory, a collected reservation, captured payment, collected fulfillment transition, and governance audit evidence.
- The isolated database and dump were removed after verification.

This is `LOCAL_RESTORE_TECHNICAL_EVIDENCE`. It is not production backup, RPO, RTO, retention, or disaster-recovery certification.

## Missing owner decisions

- production RPO;
- production RTO;
- retention period;
- backup frequency;
- production Supabase plan and enabled backup capability;
- PITR requirement;
- encryption and key authority;
- restore authority and named owner;
- isolated restore-test cadence and evidence location.

## Technical options supported by the current infrastructure

- Supabase plan-provided backups and PITR, if the deployment owner selects and enables a plan that provides them;
- deployment-controlled logical PostgreSQL dumps to an owner-approved encrypted store;
- isolated restore verification using schema/auth state plus representative Partner, inventory, reservation, payment, fulfillment, and audit invariants;
- migration-ledger, RLS, checksum, and application smoke verification after restore.

These are options, not assertions about the production environment.

## Repository changes blocked on owner decisions

- a production backup schedule and retention configuration;
- production restore runbook endpoints, credentials, and named responders;
- approved RPO/RTO alert thresholds;
- evidence of an actual production-like restore exercise.

Final B2 classification: `OWNER_POLICY_BLOCKED`.
