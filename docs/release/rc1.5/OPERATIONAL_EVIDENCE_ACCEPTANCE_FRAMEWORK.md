# MedLink Operational Evidence Acceptance Framework

Version: 1.0  
Effective date: 2026-07-30  
Program: RC1.5 Operational Validation  
Status: **ACTIVE**

## Mission

Establish one controlled process for receiving, validating, approving, and
incorporating external operational evidence into the RC1.5 release package.

The framework ensures that only verified evidence influences the GA decision,
the certified RC1 baseline remains protected, and every release-state change is
traceable and auditable.

## Scope

This framework applies to externally generated evidence for:

- Penetration tests and vulnerability assessments
- Backup, restore, point-in-time recovery, and disaster-recovery exercises
- Production infrastructure, monitoring, alerting, DNS, and TLS validation
- Authenticated cross-tenant and RBAC testing
- Provider and integration conformance
- Hypercare execution and operational handover
- Dependency and security risk acceptance
- CAB decisions and executive approvals

## Governing principles

1. Evidence is untrusted until accepted through every lifecycle stage.
2. Missing, expired, unverifiable, incomplete, or conflicting evidence fails
   closed.
3. Receipt does not imply authenticity, acceptance, or release approval.
4. Reviewers may not approve evidence for which they are the submitting party
   when independence is required.
5. Sensitive evidence remains in the approved evidence repository; this source
   repository records metadata, hashes, conclusions, and authorized references.
6. PHI, credentials, private keys, access tokens, exploit secrets, and
   unnecessary sensitive infrastructure details must not be committed.
7. Evidence acceptance may close only the gates explicitly supported by its
   scope.

## Evidence lifecycle

```text
Evidence Received
        |
        v
Quarantine and Registration
        |
        v
Authenticity Verification
        |
        v
Completeness Review
        |
        v
Technical Assessment
        |
        v
Governance Approval
        |
        v
Repository Incorporation
        |
        v
Independent Release Reassessment
```

No stage may be skipped.

## Roles and segregation of duties

| Role | Responsibility |
| --- | --- |
| Evidence Custodian | Receives, quarantines, hashes, stores, and registers submissions |
| Domain Reviewer | Assesses technical scope, method, results, and gate coverage |
| Security/Operations/Data Owner | Approves evidence in the accountable domain |
| Release Manager | Confirms completeness and authorizes repository incorporation |
| Compliance/Audit Reviewer | Verifies chain of custody, retention, and conflicts |
| Executive Release Authority | Approves GA only after all mandatory gates close |

The submitter, custodian, technical reviewer, and final approver must be
identified. Any role overlap requires a documented independence exception.

## Stage 1: quarantine and registration

On receipt:

1. Assign a stable identifier in the form `OEAF-{DOMAIN}-{YYYYMMDD}-{NNN}`.
2. Record receipt timestamp, submitter, source organization, delivery channel,
   filenames, media types, and stated release/gate scope.
3. Store the original artifact read-only in the approved evidence repository.
4. Calculate SHA-256 for every file before review.
5. Scan files using approved malware and content controls.
6. Restrict access to the minimum authorized reviewer group.

Evidence must not be opened through unsafe active-content tooling or committed
to Git during quarantine.

## Stage 2: authenticity verification

The Evidence Custodian verifies:

- Identifiable source organization and named author
- Assessor authorization, competence, and independence where required
- Signature, certificate, provider attestation, or other authorization
- Relevant assessment date and target release/environment
- Unbroken delivery and custody record
- SHA-256 matching the registered original
- No unexplained alteration after signature or approval

Failure results in `REJECTED_AUTHENTICITY`. The submission cannot influence a
release gate.

## Stage 3: completeness review

The Domain Reviewer verifies:

- Objective, scope, exclusions, target, methodology, and execution dates
- Environment, release, configuration, database, provider, and region versions
- Results, raw/supporting artifacts where required, limitations, and exceptions
- Findings with severity, impact, owner, disposition, and retest status
- Conclusions, recommendations, and named approvals
- RTO/RPO, integrity, tenant, or other measurements required by the gate

Material omissions result in `MORE_INFORMATION_REQUIRED`. A partial artifact
may be accepted only for explicitly identified sub-gates and cannot imply
completion of the broader gate.

## Stage 4: technical assessment

The reviewer determines:

1. Which exact release gate and acceptance criteria the evidence addresses.
2. Whether the tested target is equivalent to the certified RC1 baseline.
3. Whether methods and sample sizes are appropriate and reproducible.
4. Whether results conflict with repository or previously accepted evidence.
5. Whether findings require remediation, retest, exception, or risk acceptance.
6. Whether the artifact supersedes prior evidence and why.
7. Its validity period and reassessment triggers.

Assessment outcomes are:

- `PASS`
- `PASS_WITH_CONDITIONS`
- `FAIL`
- `MORE_INFORMATION_REQUIRED`
- `OUT_OF_SCOPE`

## Stage 5: governance approval

Approval requires:

- Domain owner decision
- Reviewer identity and review timestamp
- Conditions and expiry, if applicable
- Evidence and assessment SHA-256 values
- Valid signature or approved authorization mechanism
- Conflict-of-interest declaration
- Release Manager confirmation

Risk acceptance must identify probability, impact, compensating controls,
accountable owner, target remediation release, monitoring, expiry, and executive
authority. An unsigned risk entry is not accepted risk.

## Stage 6: repository incorporation

Repository updates are permitted only when the evidence:

1. Passes authenticity verification.
2. Meets the required completeness standard.
3. Has an approved technical assessment.
4. Is approved by the responsible owner.
5. Changes or materially supports an operational gate.

Permitted changes are limited to:

- Approved evidence metadata and immutable references under
  `docs/release/rc1.5`
- Status updates to the affected certification record
- Approval metadata and evidence hashes
- The release decision, only after independent gate reassessment

Prohibited changes include production code, schemas, migrations, APIs,
dependencies, features, AI capabilities, runtime behavior, and RC2
implementation.

The incorporation change must use a documentation-only review, exclude
`.env.example`, identify every affected gate, and link the acceptance record.

## Evidence acceptance record

Create one record for every submission, including rejected submissions:

| Field | Required |
| --- | --- |
| Evidence identifier and version | Yes |
| Original filename/media type | Yes |
| Submission and receipt timestamps | Yes |
| Submitter and source organization | Yes |
| Target environment/release | Yes |
| Evidence SHA-256 | Yes |
| Storage reference and access classification | Yes |
| Authenticity result/reviewer/date | Yes |
| Completeness result/reviewer/date | Yes |
| Technical outcome and affected gates | Yes |
| Findings, conditions, and expiry | When applicable |
| Governance decision/approver/signature | Yes |
| Superseded evidence identifiers | When applicable |
| Repository documents and commit updated | After incorporation |
| Resulting gate and program status | After reassessment |

## Release-gate reassessment

After an accepted submission:

1. Recalculate only the affected operational gates.
2. Verify that dependent and cross-cutting gates remain valid.
3. Identify all mandatory gates still open.
4. Check for expired or superseded evidence.
5. Record the before/after state and rationale.
6. Update GA only when accumulated evidence justifies the outcome.

A single report cannot authorize GA unless it closes every remaining mandatory
gate or each remaining risk has valid, unexpired, authorized acceptance.

## Rejection, supersession, and revocation

- Rejected evidence remains in the audit register with its reason and cannot be
  used as supporting evidence.
- New evidence does not silently overwrite prior evidence; it identifies what
  it supersedes.
- Evidence is revoked if its signature or integrity fails, its target materially
  changes, a material error is discovered, a related finding reopens, or its
  validity expires.
- Revocation immediately triggers release-gate reassessment. If necessary, the
  program status moves backward and fails closed.

## Current program state

```text
Engineering               COMPLETE
Technical Certification   COMPLETE
Operational Validation    IN PROGRESS
GA                        NO-GO
Engineering Freeze        ACTIVE
RC2                       BLOCKED
Engines 36–40             NOT AUTHORIZED
```

Adopting this framework does not change any release gate.

## Exit and transition

OEAF remains active until all mandatory operational gates are satisfied, GA is
authorized as `GO` or `GO WITH ACCEPTED RISKS`, and the production release is
approved. It then continues as the evidence-control process for hypercare,
operational handover, post-implementation review, steady-state operations, and
future releases.
