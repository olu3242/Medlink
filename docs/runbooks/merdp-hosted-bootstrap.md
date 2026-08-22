# MERDP hosted catalogue bootstrap

This command imports only NAFDAC Greenbook catalogue data. It does not create
authentication users, personas, memberships, pharmacy locations, inventory, or
clinical fixtures. Those domains must use their own canonical onboarding paths.

The input manifest binds immutable product and manufacturer files to an explicit
Supabase project and environment. Every file hash, byte count, row count, and
column count is verified before database access can mutate catalogue state.
Dry-run mode performs no mutations. Apply mode calls the existing
`SupabaseMerdpRepository` persistence path and the transactional
`run_merdp_wave1_convergence` RPC.

Use dedicated, short-lived operator environment variables:

```powershell
$env:MEDLINK_MERDP_SUPABASE_URL='https://PROJECT_REF.supabase.co'
$env:MEDLINK_MERDP_SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
npm run merdp:bootstrap -- --manifest C:\secure\manifest.json --environment preview --project-ref PROJECT_REF --dry-run
```

Dry-run may use `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` when target catalogue metadata is readable under
the deployed RLS policy. Apply never accepts that fallback and requires the two
dedicated operator variables above.

After reviewing the dry-run, use `--apply`. A manifest marked
`review_required` cannot be applied unless the operator also supplies
`--approve-drift-sha256` with the exact drift-report hash. This is an explicit
authorization gate, not an assertion that drift is safe.

Production is denied by default. It requires both `--allow-production` and a
separate `MEDLINK_MERDP_PRODUCTION_AUTHORIZATION` value equal to the target
project reference. Do not set either without an approved production change.

Replay the identical manifest after a successful apply. Both persisted source
runs must report `replay: true`, and target counts must show zero duplicate
canonical additions. Preserve the command output as operational evidence; never
commit source CSV files, service-role keys, or manifests containing secrets.
