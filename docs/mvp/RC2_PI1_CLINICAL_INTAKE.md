# RC2 PI-1 Clinical Intake Specification

Date: 2026-07-30  
Capabilities: `ML-CAP-006`, `ML-CAP-007`  
Workflows: `ML-WF-001` through `ML-WF-005`  
Pipeline: `ML-CPP-001`  
Engine ownership: `ML-ENG-006`, `ML-ENG-007`, `ML-ENG-013`

## Business outcome

A patient can submit a scanned prescription. MedLink verifies and stores the
source, extracts and structures its contents through bounded provider tasks,
creates immutable review evidence, and requires an independently verified
pharmacist to approve, reject, or request clarification. No automated
component can make the final clinical decision.

## Component ownership

```text
Patient UI/API
  -> Prescription intake domain
  -> private object storage + scanner
  -> existing Workflow Runtime / outbox
  -> clinical worker
       -> ARC OCR adapter
       -> ARC parser adapter
       -> deterministic quality validation
  -> immutable Clinical Evidence Object
  -> pharmacist review API/UI
  -> database-authoritative human decision
```

- `packages/prescription` owns intake and clinical processing domain rules.
- `packages/agent-runtime` owns provider task policy and telemetry contracts.
- `packages/clinical` owns pharmacist review application behavior.
- Existing Runtime, Workflow, Audit, Observability, Identity, and outbox
  components retain their ownership.
- Supabase functions own atomic persistence, leases, final-state guards, and
  the authoritative pharmacist transition.

## Data model

Migration `202607300017_pi1_clinical_pipeline.sql` adds:

- parent/child workflow linkage, stage pointers, and attempts;
- fenced outbox lease token and expiry;
- tenant-scoped verified pharmacist profiles;
- immutable OCR result evidence;
- immutable versioned clinical evidence packages;
- workflow references and decision rationale on clinical validations.

It extends existing prescriptions, items, extraction fields, findings,
workflow runs, runtime outbox, dead letter, AI provenance, and governance audit
tables. It does not create a second queue or workflow engine.

PHI-bearing OCR text, structured extraction, findings, and the clinical packet
remain in RLS-protected tables. Domain events contain opaque identifiers,
hashes, confidence values, counts, and state only.

## API contracts

### Patient intake

`POST /api/v1/prescriptions`

- Authentication: Supabase session/bearer through canonical `runApi`.
- Authorization: `prescription:create`.
- Tenant: membership-backed active tenant.
- Input: multipart file; JPG, PNG, or PDF; maximum 10 MB; idempotency key.
- Success: `201` with prescription/workflow identifiers and `received` state.
- Failure: canonical problem response; an unreferenced stored object is
  compensated on persistence failure.

### Internal clinical worker

`POST /api/internal/clinical-pipeline`

- Authentication: constant-time comparison of a dedicated bearer secret.
- Database authority: service-role client; never exposed to a browser.
- Input: `{ "limit": 1..5 }`, default 3.
- Behavior: claims and executes sequential fenced work items. A non-completed
  result stops the invocation.
- Success: worker identifier and identifier-only result summaries.

Required runtime configuration:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEDLINK_CLINICAL_WORKER_TOKEN` (minimum 32 characters)
- `MEDLINK_OCR_PROVIDER_URL`
- `MEDLINK_OCR_PROVIDER_TOKEN` when required
- `MEDLINK_PARSER_PROVIDER_URL`
- `MEDLINK_PARSER_PROVIDER_TOKEN` when required
- existing `MEDLINK_FILE_SCANNER_URL` and optional scanner token

Secrets must be supplied by the deployment secret store, never committed.

### Pharmacist review

- `GET /api/v1/review`
- `GET /api/v1/review/{validationId}`
- `PATCH /api/v1/review/{validationId}`

All routes use canonical `runApi`, permission `clinical:review`, correlation,
audit, telemetry, and safe error responses. RLS and the decision RPC further
require a current verified pharmacist profile in the same tenant.

Decision input:

```json
{
  "decision": "approved | rejected | needs_information",
  "rationale": "bounded pharmacist rationale",
  "acknowledgedFindingIds": ["uuid"]
}
```

The UI derives a stable SHA-256 idempotency key from the review identifier and
decision payload. Database replay validation rejects any changed payload under
the same key.

## Provider contracts

OCR receives source bytes, MIME, correlation ID, and abort signal and returns:

```json
{
  "text": "bounded OCR text",
  "pageCount": 1,
  "confidence": 0.94,
  "provider": "provider-name",
  "model": "model-version"
}
```

Parsing receives OCR text, correlation ID, and abort signal and returns one to
thirty structured medicine items. Each field contains a bounded string value
and confidence from 0 to 1. Strict schemas reject additional properties.

Provider output is untrusted until schema validation succeeds. Source size and
SHA-256 are reverified immediately before OCR. Provider errors retry; invalid
contracts and integrity failures fail closed.

## Reliability and observability

- Claims use `FOR UPDATE SKIP LOCKED`, worker ID, lease token, and expiry.
- Completions require the live fence; stale completion fails.
- A stage has a 45-second task timeout, five attempts, exponential backoff
  capped at five minutes, then existing dead-letter handling.
- Domain state, workflow evidence, audit evidence, and outbox events commit in
  the same database transaction.
- ARC telemetry records identifiers, capability, action, status, duration, and
  safe error code, never OCR text or findings.
- `/api/v1/health` exposes only whether worker configuration is present.

## Deployment and rollback

1. Apply migration `017` to an isolated RC2 database and run RLS/tenant tests.
2. Configure private storage, scanner, OCR/parser endpoints, service role, and
   worker secret.
3. Deploy `web`, `patient`, and `pharmacist` applications from the same commit.
4. Invoke one worker item at a time during canary; verify queue, retry, audit,
   and evidence metrics before raising the batch limit.
5. Stop worker invocation to halt processing safely. Do not reverse a partially
   applied migration. Roll forward with a new migration; immutable evidence and
   published events are never rewritten.

## Known boundary

Source/static implementation is verified. Live Supabase migration, storage,
provider, RLS, license-verification, lease-expiry, and authenticated
cross-tenant evidence are required before Pilot Certified status. Until that
evidence exists, this increment is Implemented, not Certified.
