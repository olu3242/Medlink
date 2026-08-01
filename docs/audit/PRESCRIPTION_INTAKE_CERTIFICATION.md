# Prescription Intake Runtime Certification (G05, Engine 26)

Scope: `docs/audit/LAUNCH_GAP_MATRIX.md`'s G05 finding -- "no storage
integration, no storage path persistence, no file metadata, no OCR" -- this
closes the non-OCR part of that finding. Per the program's own instruction,
OCR remains an enhancement, not built here; the workflow functions
correctly with pharmacist review of the stored file alone.

## What was built

- **Storage bucket + RLS** (`supabase/migrations/202608010003_prescription_file_storage.sql`).
  A private `prescriptions` bucket, 15 MiB limit, MIME allowlist enforced at
  the storage layer (defense-in-depth alongside the application-level check
  below). Object key convention: `{organization_id}/{patient_id}/{object
  id}-{sanitized file name}`. `storage.objects` RLS mirrors
  `prescriptions_read`/`prescriptions_create`'s existing logic exactly
  (patient owns their own path segment; pharmacist/pharmacy_staff/
  tenant_admin/platform_admin can read within their organization) --
  parsed from the path via `storage.foldername(name)`, the standard
  Supabase Storage RLS pattern. No update/delete policy: an uploaded
  prescription image is immutable, matching this platform's other audit
  trails (`conversation_events`, `mar_audit_events`).
- **Checksum/mime/size metadata + duplicate detection.** Three new nullable
  columns on `prescriptions` (already had `storage_bucket`/
  `storage_object_path` since Wave 2's schema, migration
  `202607270002` -- just never wired to anything real). A partial unique
  index scopes duplicate detection per tenant, the same boundary every
  other content-addressed uniqueness constraint in this repository uses.
- **`create_prescription_record` extended, not replaced.** Three new
  trailing parameters, each `default null` -- the existing caller
  (`apps/admin/lib/application.ts`'s `PrescriptionApplication.create()`)
  needed zero changes; PostgREST omits keys it doesn't set and Postgres
  applies the default. A checksum match within the same organization now
  replays the existing row instead of erroring, giving idempotent retry
  and duplicate-upload detection from one signal. The old 11-argument
  function signature was explicitly dropped first, so old and new callers
  share one function rather than creating an ambiguous second overload.
- **`packages/prescription/src/file-intake.ts`** -- pure, tested
  `validatePrescriptionFile()` (MIME allowlist + 15 MiB limit, mirroring
  the bucket's own enforcement) and `sanitizePrescriptionFileName()`
  (strips path separators and leading dots so a malicious file name can't
  inject extra segments into the object key). `PrescriptionFileStore` port.
- **`apps/patient/lib/prescription-storage.ts`** --
  `SupabasePrescriptionFileStore`: uploads bytes, computes a real SHA-256
  checksum, generates a 10-minute signed URL for retrieval (long enough
  for a pharmacist to review a queue entry, short enough that a leaked
  link doesn't stay valid indefinitely).
- **`apps/patient/lib/prescription-intake.ts`** -- `PrescriptionIntakeApplication`:
  validate -> store -> `create_prescription_record`, and `getFileUrl()`
  for retrieval (looks the prescription up through the caller's own
  RLS-evaluated session -- `prescriptions_read` already scopes this
  correctly, no additional check needed).
- **Real routes**, both going through the canonical `runApi` pipeline like
  every other route in this app (verified by
  `packages/runtime/src/architecture.test.ts`, which also caught and
  corrected an early draft of the retrieval route that queried
  `.from()` directly instead of through the application class):
  - `POST /api/v1/prescriptions` (multipart/form-data: `patientId`,
    `idempotencyKey`, `file`) -- `apps/patient/app/api/v1/prescriptions/route.ts`.
  - `GET /api/v1/prescriptions/{id}/file-url` --
    `apps/patient/app/api/v1/prescriptions/[id]/file-url/route.ts`.

## Known, accepted tradeoff

A literal retry of an identical upload still writes the bytes to storage a
second time before `create_prescription_record`'s checksum check can
short-circuit it -- the checksum can only be computed (and therefore
checked) after the file store has hashed what it stored. The RPC still
correctly de-duplicates the *database record*, which is what actually
matters for "was this prescription already received." Avoiding the
redundant storage write would need the port's contract to accept a
precomputed checksum rather than computing its own; not done here to keep
this change focused.

## Deliberately not built (by program instruction)

- **OCR.** No image-to-text extraction. `packages/workflows/src/prescription-parsing.ts`'s
  WF-004 step and `record_prescription_extraction` still exist and still
  expect structured extraction data handed to them -- nothing produces
  that data from the file this pass stores. The workflow is designed to
  function with pharmacist review of the stored image alone, per the
  program's explicit scope.
- **WhatsApp-originated upload.** This is the authenticated, patient-web-session
  path (`create_prescription_record` requires a genuine `auth.uid()`
  match). G04's webhook route uses a system identity that cannot call
  actor-checked RPCs (ADR 0004's "Refinement discovered during
  implementation") -- connecting a WhatsApp media upload to this pipeline
  is a distinct, not-yet-scoped follow-up.
- **Deletion / retention policy.** No delete path exists (deliberately, per
  the immutability posture above) and no automated retention/expiry sweep
  for old prescription files -- worth a decision before real patient data
  accumulates in the bucket.

## Tests / certification evidence

- `packages/prescription/src/file-intake.test.ts` -- 12 tests: MIME/size
  validation at both boundaries, file-name sanitization including the
  path-injection case.
- `apps/patient/lib/prescription-storage.test.ts` -- 7 tests against a
  hand-rolled scripted Supabase Storage client fake: object-key
  construction matching the RLS path convention, real SHA-256 checksum
  computation (verified against Node's own `crypto` output for a known
  input), two uploads of the same file name never collide, the
  path-injection case produces exactly the expected number of path
  segments, and both storage error paths.
- `apps/patient/lib/prescription-intake.test.ts` -- 7 tests: invalid
  MIME/oversized file rejected before storage or the database are ever
  touched, a valid upload's exact RPC argument list, RPC-failure
  propagation, and the retrieval path's lookup/signing/404/error-mapping
  branches.
- `packages/runtime/src/migration.test.ts` -- new "prescription file
  storage migration" block: bucket provisioning with limits, RLS policy
  path-parsing logic, absence of any update/delete policy, the new
  columns and duplicate-detection index, the explicit drop-then-recreate
  of `create_prescription_record`'s signature, the checksum-replay branch,
  and that evidence still commits atomically.
- `packages/runtime/src/architecture.test.ts` -- pre-existing, unmodified
  test; caught a real violation in this pass's first draft (direct
  `.from()` call in a route handler) before it could land.
- `npm run check`: pass -- 492 tests passed, 8 skipped (live-DB).
- `npm run build` (all 8 app workspaces): pass; both new routes appear in
  `apps/patient`'s route table.

## Still open (honest, not fabricated PASS)

| Item | What's needed |
| --- | --- |
| Storage bucket + RLS live execution | Never applied to a live Supabase instance by this repository's tooling -- same boundary as every other migration in this session (see `docs/audit/WHATSAPP_RUNTIME_CERTIFICATION.md`'s equivalent caveat for the `auth.users` system identity) |
| OCR | Explicitly out of scope this pass; provider selection remains open (`docs/audit/RC1_BACKLOG.md` item 8's "OCR provider still unselected" finding is unchanged) |
| WhatsApp-originated prescription upload | Needs the actor-checked-RPC / signed-session decision ADR 0004 already flagged as a distinct follow-up |
| Retention/deletion policy | No automated sweep exists; a decision is needed before this handles real patient data at volume |
