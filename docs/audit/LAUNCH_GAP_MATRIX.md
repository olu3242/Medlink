# RC1 Launch Gap Matrix (G01-G10)

Date: 2026-08-01
Baseline evaluated: `main` at `7a8df66` (PR #6, open, not yet merged) and
`ad7358a` (PR #5, open, not yet merged) layered on top of `main`'s merge
base `cb04786`.

This is an evidence-based status snapshot, not a certification and not a
Go/No-Go. `docs/release/rc1-ga/GA_DECISION.md` remains the authority on
GA readiness; nothing here overrides it. Every status below is backed by a
specific file, test, migration, or command output cited inline. No status
is asserted from memory or prior documentation without independent
verification against the current repository -- **two claims in existing
certification docs did not hold up under this review** (see the callouts
in G01 and G02 below); both are flagged, not silently corrected.

## Status legend

- **Complete**: real, tested, wired end-to-end; nothing structurally
  missing for the stated scope.
- **Partial**: real, tested code exists but does not reach end-to-end, or
  covers only part of the gate's scope.
- **Open**: no evidence of implementation, or evidence exists only as
  documentation/intent.
- **Blocked**: cannot be closed by repository work alone -- needs live
  infrastructure execution, an external party, or a human decision/sign-off.

## Summary table

| Gate | Status | Risk | Go/No-Go impact |
| --- | --- | --- | --- |
| G01 Production Infrastructure | Partial | Critical | Blocks GA; does not block a controlled pilot on already-provisioned infra |
| G02 Security & Secrets | Partial | Critical | Blocks GA; the two historical leaked secrets need rotation regardless of pilot/GA |
| G03 Auth/RBAC/RLS | Partial | Critical | Blocks GA (no live cross-tenant proof); source-level RBAC/RLS is real |
| G04 WhatsApp Runtime | Partial | High | No longer blocks the core "patient starts a conversation" path (PR #6); outbound + medicine-search-over-WhatsApp still open |
| G05 Prescription Intake | Partial | Critical | **No image storage exists at all** -- blocks any real prescription upload, pilot or GA |
| G06 Pharmacist Clinical Review | Partial | High | Decision path is real and atomic; queue/notification UX incomplete |
| G07 Medicine Intelligence | Partial | Medium | Core matching/equivalency real; no dedicated normalization/duplicate-detection report |
| G08 Inventory Reservation | Partial | Critical | Atomicity is real (DB-enforced); zero live concurrency proof, no expiry sweep |
| G09 Notification Runtime | Open | High | No outbound channel is wired to anything -- WhatsApp, email, SMS all unconnected |
| G10 Pilot Operational Readiness | Blocked | Critical | Explicitly requires human sign-offs (`GA_DECISION.md`); not closable by code |

---

## G01 -- Production Infrastructure

**Status: Partial**

| Evidence | Finding |
| --- | --- |
| `.github/workflows/ci.yml` (full file read) | One job (`verify`): `npm ci`, `npm run check`, `npm run build`. No migration-reset step, no live-database step, no `secrets.*` reference of any kind. |
| `docs/release/rc1-ga/DEPLOYMENT_CERTIFICATION.md` | Claims "CI runs exact install, check, operational suites, coverage, all workspace builds/typechecks, **migration reset/recovery, and credential-gated hosted database tests**." |
| `packages/runtime/src/live-database.test.ts` | 8 tests, gated by `describe.skip` unless `MEDLINK_LIVE_SUPABASE_URL`/`MEDLINK_LIVE_SUPABASE_ANON_KEY` are set. `npx vitest run` confirms all 8 skipped. |

**Discrepancy flagged, not silently corrected:** `DEPLOYMENT_CERTIFICATION.md`'s claim that CI runs "migration reset/recovery" and "credential-gated hosted database tests" does not match the actual `ci.yml` on `main` -- there is no such step, and no secrets are injected. Either the certification document describes a CI configuration that existed on a different branch/at a different time and was never merged to `main`, or it was written aspirationally. **Whatever ran the "Hosted anonymous RLS validation | PASS" row in `GA_DECISION.md` did not run through this repository's CI** -- it was a manual/local run against a real Supabase instance with those env vars set. This needs owner clarification before being relied on as a repeatable, automated pass.

- Health endpoints real: `apps/web/app/health/{startup,ready,live,details}/route.ts` exist, `DEPLOYMENT_CERTIFICATION.md` records a local HTTP 200 smoke test.
- 28 migrations, all pass static structural/RLS certification tests (`packages/runtime/src/migration.test.ts`, `rls-matrix.test.ts`).
- `DR_CERTIFICATION.md`: **NOT CERTIFIED**. Schema-reconstruction determinism proven; managed backup, PITR, restore, regional failover all have zero execution evidence.
- `DEPLOYMENT_CERTIFICATION.md`: **CONDITIONAL**. Environment parity and promotion approval both explicitly OPEN.

**Required actions:** (1) reconcile or correct the CI-claim discrepancy above; (2) either wire `MEDLINK_LIVE_SUPABASE_*` into CI as a gated job against a real project, or stop citing it as CI evidence; (3) execute the DR exercises `DR_CERTIFICATION.md` lists (managed backup, PITR, restore, failover) against a real environment. None of (3) is achievable by repository code changes.

**Estimated effort:** (1)-(2) half a day of investigation + CI config; (3) is infrastructure-execution work, not a repo-effort estimate.

---

## G02 -- Security & Secrets

**Status: Partial**

| Evidence | Finding |
| --- | --- |
| Full git-history scan (`git log --all -p`, run before AGL-1..5 work) | Two real secrets found: a Supabase anon-key JWT and a plaintext DB password, both confined to `fix/rc1-readiness` commit `9a5686e`. **Confirmed not reachable from `main`** (`git merge-base --is-ancestor` check). Still present on the remote branch. |
| `.env.example` on `main` | Clean -- placeholder values only, verified by direct read, both before and after this session's edits. |
| `npm audit --omit=dev` (run today) | **3 high-severity findings** (PostCSS path traversal via Next.js's vendored copy, `sharp` libvips CVEs), fixable only via `next` major-version breaking change. |
| `docs/release/rc1-ga/DEPENDENCY_RISK_REGISTER.md` | Claims **15 high findings**. |

**Discrepancy flagged:** the dependency-risk document's "15 high" does not match today's `npm audit` output of 3. This could mean the tree has been updated since that document was written, or the original count was scoped differently (e.g. including dev dependencies, or a different lockfile state). Either way, **the register is stale and needs a fresh run**, not a re-cite.

- Storage bucket RLS: `grep` across all 28 migrations for `storage.buckets`/`storage.objects` returns **zero matches**. No Supabase Storage bucket, and no bucket-level access policy, exists anywhere in this codebase. (This is the same root cause as G05's prescription-image finding below -- there is no bucket to certify permissions for.)
- `SECURITY_CERTIFICATION.md`: **CONDITIONAL / NOT PRODUCTION CERTIFIED**. Rate limiting and security headers both explicitly OPEN (no repository evidence at all); penetration assessment OPEN (no independent report exists).
- RBAC/authorization: source-level real (`packages/platform/src/authorization.ts`, 100% test coverage per this session's `npm run check` output) -- see G03 for the live-verification gap.

**Required actions:** (1) rotate the two leaked credentials regardless of what happens to `fix/rc1-readiness` -- this is independent of any pilot/GA decision; (2) re-run `npm audit` against the exact production lockfile and update `DEPENDENCY_RISK_REGISTER.md` with a current, reproducible count; (3) either build storage-bucket infrastructure with RLS (needed regardless, per G05) or explicitly document that no prescription image storage exists yet so "certify storage bucket permissions" isn't silently treated as N/A; (4) commission an independent penetration test — not achievable by repository work.

**Estimated effort:** (1) minutes, but requires Supabase dashboard access outside this session; (2) under an hour; (3) is G05-sized work (see below); (4) is external/vendor engagement.

---

## G03 -- Authentication / RBAC / RLS

**Status: Partial**

| Evidence | Finding |
| --- | --- |
| `packages/platform/src/roles.ts`, `authorization.ts` | 8 roles, a closed permission matrix (`can`/`authorize`), 100% statement/branch coverage per this session's coverage output. |
| `apps/web/app/auth/sign-in/actions.ts` | `supabase.auth.signInWithOtp(...)` -- magic-link/OTP, no password auth path exists. |
| `packages/runtime/src/{wave2-rls,wave3-rls,rls-matrix}.test.ts` | All three files are explicit about what they are: static SQL-content assertions (RLS enabled + a policy exists per table), not live probes. `wave2-rls.test.ts`'s own comment: "cannot replace a live cross-tenant denial matrix - that requires a running PostgreSQL/Supabase instance this sandbox cannot reach." |
| `packages/runtime/src/live-database.test.ts` | The only *live* RLS evidence in the repo -- 8 tests, anonymous-denial only (no authenticated cross-tenant probe), and (per G01) not run by CI. |
| `docs/adr/0004-conversation-runtime-webhook-identity.md` | System identity for WhatsApp accepted this session (PR #6). Its "Refinement discovered during implementation" section: the identity cannot call any actor-checked RPC (including `record_runtime_evidence`) because service-role connections never satisfy `auth.uid()` -- an open, precisely-scoped question, not yet resolved. |

**Required actions:** (1) execute an authenticated cross-tenant test matrix against a live Supabase instance (patient A cannot read patient B's prescriptions/reservations/MARs across organizations) -- this is the single largest concrete gap in this gate, and the thing `SECURITY_CERTIFICATION.md` itself names as pending; (2) resolve ADR 0004's open question: does the WhatsApp system identity need a real signed session (Admin-API-minted or JWT-secret-signed), and if so, build it, or formally decide it stays read-only/service-role-scoped indefinitely.

**Estimated effort:** (1) needs a live Supabase project provisioned with seed data across ≥2 tenants -- a day of test-writing once that exists, but the environment itself is the blocker; (2) a half-day design decision plus implementation once decided.

---

## G04 -- WhatsApp Runtime

**Status: Partial** (materially improved this session -- PR #6)

Full evidence: `docs/audit/WHATSAPP_RUNTIME_CERTIFICATION.md`. Summary:

- **Closed:** inbound webhook route, signature verification, duplicate-delivery idempotency, conversation state, human handoff on an unwired workflow intent. 13 new tests exercise the full request/response cycle through the real `createRuntime()` pipeline.
- **Open:** medicine-search-over-WhatsApp doesn't complete end to end (`apps/web` has no medicine-search adapter -- confirmed by this matrix's own re-check: `grep` for `TrigramMedicineSearchIndex`/`SupabaseSearchMedicineReader` outside `apps/admin` returns nothing); no outbound WhatsApp reply delivery is wired (`GraphApiWhatsAppSender` exists, tested, called from nowhere -- confirmed by `grep -rl GraphApiWhatsAppSender apps/` returning zero hits); no actor-checked mutation (e.g. `create_mar`) is reachable from a WhatsApp intent.
- Not yet merged: PR #6 is open, draft, CI last observed queued.

**Required actions / effort:** see the WhatsApp certification doc's own table -- unchanged since it was written.

---

## G05 -- Prescription Intake

**Status: Partial -- with one Critical, previously undocumented finding**

| Evidence | Finding |
| --- | --- |
| `apps/web/lib/prescription-uploader.ts` (full read) | `SupabasePrescriptionUploader.upload()` calls `create_prescription_record` RPC only -- inserts a database row. No `supabase.storage.from(...)` call anywhere in the file. |
| `grep -rn "\.storage\.from(" apps/ packages/` (excluding tests) | **Zero matches, repository-wide.** |
| `grep -n "image_url\|media_url\|file_path\|storage_path" supabase/migrations/*.sql` scoped to prescription tables | **Zero matches.** No column exists to reference a stored image at all. |
| `packages/prescription/src/parser.ts` | Parses/validates already-extracted structured fields; not an image-to-text OCR engine. |
| `grep` for OCR provider integrations (Tesseract, Google Vision, AWS Textract, `OCR_API_KEY`) across the whole repo | **Zero matches.** |
| `packages/workflows/src/prescription-parsing.ts`, `prescription-upload.ts` | Real, tested `WorkflowStep` implementations exist and are wired into WF-003/WF-004 -- but they operate on the metadata record, not an actual image. |

**This is the most significant finding in this matrix.** "Upload a prescription image" is one of RC1's own named success-criterion steps (`IMPLEMENTATION.md`: "...upload a prescription, receive OCR-assisted identification..."), and neither the storage layer nor the OCR layer exists anywhere in this codebase -- not partially built, not stubbed, structurally absent. The `record_prescription_extraction` RPC and its workflow step record *whatever structured data is handed to them*; nothing in the repository produces that data from an actual photo. `apps/admin/lib/prescription-extraction.ts`'s naming is misleading in this light -- it persists extraction results, it does not extract anything.

**Required actions:** (1) design and provision a Supabase Storage bucket with RLS/signed-URL access control for prescription images (blocks G02's "certify storage bucket permissions" too, since there's currently nothing to certify); (2) select and integrate a real OCR provider; (3) add the missing schema (image reference column(s), migration); (4) wire an actual upload path from a channel (WhatsApp media download, or a web upload form) through storage into the existing `create_prescription_record`/`record_prescription_extraction` RPCs.

**Estimated effort:** this is the largest single body of net-new work in this matrix -- storage + OCR integration + schema + wiring is comfortably a multi-day effort on its own, not a "next batch" item.

---

## G06 -- Pharmacist Clinical Review

**Status: Partial**

| Evidence | Finding |
| --- | --- |
| `supabase/migrations/202607290017_decide_clinical_review.sql`, `202607290019` | Atomic, idempotent-replay-safe decision RPC (fixed for a concurrency race earlier this session), transitions `validated -> reviewed` on approval. |
| `packages/clinical/src/validation.ts` | Three real rules: `DuplicateTherapyRule`, `PatientAllergyRule`, `PolypharmacyRiskRule` (expanded from one this session). |
| `apps/pharmacist/app/review/[id]/page.tsx`, `apps/admin/app/api/v1/equivalents/[id]/review/route.ts`, `apps/patient/app/api/v1/review/route.ts` | Review-related routes/pages exist across three apps. |
| `packages/agents/src/registry.ts` (AGL-1, PR #5) | Clinical Review Assistant agent's `flag_validation_findings` capability is explicitly `requiresHumanApproval: true`; `review_medicine_equivalence`/`decide_clinical_review` are typed as unreachable by any agent capability. |

**Required actions:** (1) verify `apps/pharmacist/app/review/[id]/page.tsx` is a real, functioning queue (not just a detail view) -- this matrix did not read its full contents; (2) confirm the "needs information" flow claimed by the original superprompt exists as a real state, not just `pending`/`approved`/`rejected`/`needs_information` in the enum with no route exercising it; (3) end-to-end certification test connecting upload -> validation -> review -> decision, which cannot exist meaningfully until G05's storage/OCR gap closes.

**Estimated effort:** (1)-(2) a day of verification/possible small fixes; (3) blocked on G05.

---

## G07 -- Medicine Intelligence

**Status: Partial**

| Evidence | Finding |
| --- | --- |
| `packages/medicine/src/equivalency.ts` | `PharmacistEquivalencyService`, `CatalogEquivalencyService` -- real, tested equivalency logic requiring pharmacist review for substitution (never autonomous, matching AGL-1's `humanExclusiveOperations`). |
| `packages/medicine/src/validation.ts` | `normalizeMedicineName()` exists and is used by both `apps/admin`'s catalog mapper and the search index. |
| `supabase/migrations/202607290011_generics.sql` | First-class `generics` table, backfilled from `medicines.generic_name`, kept in sync by trigger (this session's Wave 2 work). |

**Required actions:** the original superprompt's Engine 7 asks for a dedicated "Medicine Normalization Report" and "Duplicate Analysis" -- neither exists as a standalone artifact today (the *mechanism* exists; a report characterizing its output against real catalog data does not, and can't meaningfully be produced without a real, populated catalog).

**Estimated effort:** low, once real catalog data exists to run the report against -- this is more a G10/pilot-data-readiness dependency than new code.

---

## G08 -- Inventory Reservation

**Status: Partial**

| Evidence | Finding |
| --- | --- |
| `supabase/migrations/202607290010_reserve_inventory.sql` | Atomic: reservation row, inventory lock, MAR transition, and evidence commit together. Concurrency safety is real and DB-enforced -- `inventory_locks`' `sync_inventory_lock_quantity()` trigger relies on Postgres row-level locking within the transaction, not application-level coordination. |
| `202607290020_reserve_inventory_replay_validation.sql` | Idempotent replay validates the replayed payload actually matches the stored reservation (fixed this session, Codex P2 finding). |
| `grep` for actual concurrent-execution tests (`concurren`) across the test suite | All hits are **static SQL-content assertions** about `WHERE`-clause race guards (e.g. "guards the UPDATE itself against a concurrent transition"), not a test that runs two real concurrent transactions against a live database. |

**The specific scenario the original superprompt asked to verify (`Stock = 1, Patient A reserves, Patient B reserves -> A reserved, B out of stock, never both reserved`) has never been executed.** The trigger-based mechanism is a legitimate, standard way to get this guarantee from Postgres, and the design is sound on inspection -- but "sound on inspection" and "proven under real concurrent load" are different claims, and only the former exists today.

- No reservation-expiry sweep found (`grep` for an expiry worker/cron touching `reservations` returns nothing) -- a reservation that should expire has no automated mechanism to actually expire it.

**Required actions:** (1) a live-database test harness that opens two concurrent connections and races them against the same inventory row -- needs the same live Postgres environment every other "live" gap in this matrix needs; (2) build or locate a reservation-expiry mechanism (cron/worker), currently absent.

**Estimated effort:** (1) a day of test-writing once a live environment exists; (2) a day, depends on whether `packages/runtime`'s background/worker profile has a scheduling mechanism already (not verified in this pass).

---

## G09 -- Notification Runtime

**Status: Open**

| Evidence | Finding |
| --- | --- |
| `packages/notifications/src/service.ts` (full read, 11 lines) | `NotificationService` is a real, minimal, idempotent dispatch shell -- channel-agnostic, takes an array of `NotificationChannel` implementations. |
| `grep -rl "implements NotificationChannel" apps/ packages/` | **Zero matches.** No concrete channel (WhatsApp, email, SMS, push) has ever been implemented against this interface. |
| `grep -rl "OutboxDispatcher" apps/` | **Zero matches.** The general outbox-consumer runner (`packages/workflows/src/service.ts`'s `OutboxDispatcher`) is not invoked by any app route or worker. |
| `grep -rl "GraphApiWhatsAppSender" apps/` (excluding tests) | **Zero matches** -- confirmed again from G04's own finding: the one channel implementation that *does* exist (WhatsApp outbound send) is not wired to `NotificationService` or anything else. |

**No outbound notification of any kind is operational today** -- not WhatsApp, not email, not SMS. `notification_outbox`/`notification_delivery_attempts` (migration `202607270004`) are real, RLS-protected, service-role-only tables with a correct schema, but nothing drains them. This matches this session's own earlier finding (RC1_BACKLOG "general event outbox consumers" investigation) and confirms it's still true.

**Required actions:** (1) implement at least one real `NotificationChannel` (WhatsApp is the obvious first choice, given `GraphApiWhatsAppSender` already exists and is tested); (2) wire `OutboxDispatcher` (or an equivalent consumer) into a route or scheduled worker so `notification_outbox` rows are ever actually processed; (3) connect the specific notification triggers the original superprompt named (reservation expiry, review complete, needs-information) to real outbox-producing events -- verify which of these already produce an outbox row today versus which don't exist as an event at all (not verified in this pass).

**Estimated effort:** (1)-(2) a focused 1-2 day batch, similar scope to the WhatsApp webhook route work; (3) depends on the audit in that item, likely another day.

---

## G10 -- Pilot Operational Readiness

**Status: Blocked** (not "Open" -- distinguished deliberately)

| Evidence | Finding |
| --- | --- |
| `docs/release/rc1-ga/GA_DECISION.md` | **NO-GO.** Explicitly lists what remains: managed backup/restore (FAIL, no execution evidence), disaster recovery (FAIL), production deployment/rollback (OPEN), provider conformance (OPEN), hypercare exit (OPEN), compliance evidence review (OPEN), and **required human approvals (OPEN)** -- Security, Operations, Data, Compliance, Clinical, Product, and Executive sign-offs, none of which a repository can produce. |
| `docs/runbooks/production-operations.md`, `enterprise-service-operations.md` | Real runbook documents exist. |
| `docs/audit/PRODUCTION_OPERATIONS_ENGINES_16_20.md` | Documents operational engine coverage from earlier waves. |

This gate is marked **Blocked**, not merely **Open**, because its remaining items are categorically different from every other gate in this matrix: they require live infrastructure execution this sandbox cannot reach (no live Postgres, no live Meta developer console, no deployed environment -- confirmed repeatedly throughout this matrix and `docs/audit/RC1_SPRINT_REPORT.md` Phase 1), an independent external party (penetration testing, provider conformance), or a human's explicit sign-off that no code change can substitute for. Per your own instruction, this stays documented as OPEN/blocked with exact evidence needed, never marked PASS without real evidence.

**Required actions:** all seven items `GA_DECISION.md`'s "Conditions to reconsider" section already lists, verbatim -- this matrix adds nothing to that list, it confirms nothing in the repository state changes it.

**Estimated effort:** not a repository-effort estimate. Owner-driven (scheduling exercises, commissioning external review, collecting sign-offs).

---

## Cross-cutting observations

1. **Every "live" or "cross-tenant" claim in this repository's certification documents ultimately traces back to the same root cause**: this development environment has no live PostgreSQL/Supabase instance to test against (`docs/audit/RC1_SPRINT_REPORT.md` Phase 1's original finding, still true today). G01, G03, and G08's biggest gaps are all instances of this one structural limitation, not three unrelated problems.
2. **G05's storage/OCR absence is the single highest-priority code gap** in this matrix -- it blocks the platform's own stated MVP success criterion outright, independent of GA vs. pilot scope, and independent of every other gate's status.
3. **G09's complete lack of outbound delivery** means G04's WhatsApp webhook (PR #6) can receive messages but the platform cannot yet reply to a single one -- worth weighing against G05 for next-batch priority, since a reply-capable loop plus real image intake together would be the first genuinely demoable "patient uses WhatsApp" path.
4. Two certification-document claims did not survive re-verification this pass (G01's CI description, G02's dependency-finding count) -- both flagged above rather than propagated. Worth a broader pass to check whether other historical certification documents have similarly drifted from current `main`, given how much of this repository's history is merge-heavy multi-branch work.
