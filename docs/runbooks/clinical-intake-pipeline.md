# Clinical intake pipeline operations

Scope: `ML-CPP-001`, `ML-WF-002` through `ML-WF-005`  
Owner: Platform Operations with on-call Pharmacist Operations  
Privileged execution: authorized operators only

## Signals

Monitor:

- pending/retrying clinical outbox count and oldest age;
- publishing claims whose lease has expired;
- stage duration, completion, retry, and dead-letter rate;
- OCR/parser availability and provider contract failures;
- source integrity failures;
- pending review count and oldest review age;
- pharmacist decision failures caused by verification or acknowledgement;
- runtime API latency/error rate and database health.

Never place OCR text, structured extraction, clinical findings, rationale,
patient identifiers, provider tokens, or signed storage URLs in logs or alerts.

## Triage

1. Capture correlation ID, source event ID, workflow ID, pipeline ID, stage,
   attempt, safe error code, and timestamps.
2. Confirm `/health/live`, `/health/ready`, and `/api/v1/health`.
3. Determine whether impact is one prescription, one tenant, one provider, or
   all workers.
4. Check provider and Supabase health without printing credentials or request
   bodies.
5. Confirm worker configuration exists and the scheduler calls the protected
   endpoint with the intended batch limit.
6. Inspect the existing dead-letter and workflow evidence views using an
   authorized tenant/operator account.

## Queue backlog

1. Pause increases in worker concurrency.
2. Compare queue age with provider latency and database contention.
3. If providers and database are healthy, increase scheduled worker frequency
   gradually; keep each invocation at five stages or fewer.
4. Stop scaling when retry/dead-letter rate increases.
5. Verify oldest age, depth, and stage completion return below the alert
   threshold.

## Provider outage

1. Confirm the failure is external and retryable.
2. Leave queued events intact; exponential retry is automatic.
3. Disable scheduled worker invocation if repeated calls would exceed provider
   limits or the five-attempt budget.
4. Restore provider connectivity/configuration.
5. Resume at batch limit one and verify one OCR and one parsing completion.
6. Increase gradually while monitoring retry and contract-error rates.

Do not substitute an unapproved provider or bypass ARC policy during an
incident.

## Stale lease

An expired publishing lease is reclaimable. The new claim receives a new token.
The old worker is fenced and cannot complete.

1. Verify the previous process is stopped or isolated.
2. Invoke the worker once.
3. Confirm the attempt increments and a new lease token/expiry is recorded.
4. Confirm any late completion receives the safe stale-lease error.
5. Verify exactly one immutable stage result and one downstream queue event.

Never manually clear a live lease or update an outbox payload.

## Dead letter

1. Classify the safe error code as configuration, provider, source integrity,
   contract, database, or code defect.
2. Preserve the dead-letter record and immutable source/evidence.
3. Correct the cause under change control.
4. Use the existing dead-letter replay procedure with the same tenant,
   aggregate, correlation, and workflow references.
5. Verify the replay does not duplicate OCR evidence, items, validation,
   findings, audit entries, or downstream events.

Integrity or invalid-contract failures require engineering review before
replay; do not convert them to retryable failures.

## Review queue incident

1. Confirm the operator has tenant role `pharmacist`.
2. Confirm a verified, active, non-expired pharmacist profile exists.
3. Verify RLS denies a different tenant and an unverified pharmacist.
4. Confirm all required findings were explicitly acknowledged.
5. Retry the exact decision with the same idempotency key.
6. If the outcome is uncertain, inspect validation, prescription, workflow,
   governance audit, and outbox evidence before retrying.

Never update final prescription/validation state directly. Never mutate OCR or
clinical evidence to resolve a review.

## Recovery verification

Recovery is complete only when:

- queue depth and oldest age are healthy;
- no unexpected expired claims remain;
- a canary traverses OCR, parsing, validation, packet creation, and review;
- state and evidence hashes are consistent;
- exactly one terminal decision event exists;
- no PHI appears in logs or outbox payloads;
- operational evidence is attached to the PI-1 certification package.

## Escalation

- Security/tenant isolation/integrity: stop affected processing immediately
  and engage Security and the incident commander.
- Clinical decision or evidence mismatch: stop the affected prescription and
  engage the Clinical Lead.
- Provider or database outage: engage Platform Operations and vendor support.
- Repeated dead letters after remediation: engage Engineering; do not bypass
  the failed stage.
