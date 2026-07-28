# MedLink RC1 Enterprise Platform Evolution Framework

## Status

Accepted. This is the final foundational governance artifact. Future work
should execute approved RC1 batches rather than create additional foundational
frameworks.

## Mission

MedLink is a continuously evolving healthcare platform. Every change must add
or improve capability while preserving clinical safety, reliability,
multi-tenancy, API compatibility, regulatory compliance, and patient
experience.

## Change classification

No work begins until it has one classification.

```text
Platform -> Capability -> Engine -> Workflow -> Feature -> Improvement
```

| Level | Change class | Examples | Minimum governance |
| --- | --- | --- | --- |
| 1 | Platform | Tenant model, identity, runtime, security | ADR, architecture review, full certification |
| 2 | Engine | Medicine, Inventory, Conversation | Engine review, API review, tests, engine certification |
| 3 | Workflow | Prescription Upload, Reservation, Consultation | Workflow review, state-machine validation, event review |
| 4 | Feature | Search filter, reminder preference, pickup QR | Standard PR and tests |
| 5 | Bug fix | Correctness, regression, production defect | Root-cause analysis and regression test |
| 6 | Documentation | Contracts, guides, evidence | Cross-reference and terminology validation |

If a change spans levels, the highest level determines governance.

## Stable architecture

The following are stable and require an ADR to change:

- Enterprise Runtime Contract lifecycle
- Engine and System of Record boundaries
- Canonical workflows and identifiers
- Canonical business objects
- State-machine identities and transition semantics
- Published event contracts
- Tenant and authentication models
- Conversation model and channel independence

An ADR does not waive safety or certification. It records the decision,
alternatives, migration impact, compatibility plan, risks, and required
evidence.

## API evolution

- Every public or cross-engine API is versioned.
- Evolution within a version is backward-compatible and additive.
- Existing fields are not removed, renamed, repurposed, narrowed, or given new
  meanings.
- New fields are optional unless a new version is introduced.
- Breaking changes require a new major path such as `/api/v2`, a migration
  guide, coexistence period, telemetry, and deprecation approval.
- Security fixes may restrict previously unsafe behavior but still require
  documented compatibility analysis.

## Database evolution

- Never edit a historical migration after it has been applied or released.
- Add a new ordered migration for every schema change.
- Prefer expand/migrate/contract changes that preserve rolling compatibility.
- Provide rollback where safe; otherwise provide tested forward remediation.
- Update the data dictionary, ERD, affected APIs, RLS policies, indexes, privacy
  classification, retention behavior, and tests.
- Prove clean application and tenant-isolation behavior before certification.

## Workflow evolution

Workflow identifiers never change or get reused. `WF-006` always identifies the
Medication Access Request workflow.

Steps and implementations may evolve through versioned definitions. Changes
must preserve in-flight instances or provide an explicit migration, timeout,
compensation, and recovery plan. State-machine, event, authorization, audit, and
channel compatibility are reviewed together.

## Event evolution

- Published event type and version pairs are immutable contracts.
- Never rename, reuse, or silently change event meaning.
- Additive optional metadata may be introduced when old consumers remain safe.
- New semantics require a new event type or major event version.
- Producers and consumers use schemas, idempotency, compatibility tests, and
  deprecation telemetry.

For example, `reservation.created` remains creation evidence;
`reservation.confirmed` is a distinct event.

## AI evolution

Every AI capability is replaceable through a typed provider-neutral adapter.
Domain and workflow code depend on governed capability contracts, never a model
vendor.

Model, prompt, retrieval, and policy changes are versioned and evaluated for
accuracy, safety, bias, privacy, latency, and cost. Human review, confidence,
provenance, override, audit, and rollback obligations remain intact across
providers.

## Conversation evolution

Conversation logic is channel-independent. WhatsApp is the first adapter.
Future SMS, USSD, voice, mobile, and web-chat channels reuse canonical
workflows, domain APIs, runtime context, events, and safety policies.

A new channel may adapt presentation and transport constraints. It may not fork
business logic or create a competing System of Record.

## Release lifecycle

```text
Architecture and scope approval
    -> Development
    -> Certification
    -> Pilot
    -> Production
    -> Monitoring
    -> Post-release review
```

Promotion requires retained evidence and named approval. Failed gates return
the release to development; they are not waived by schedule pressure.

## Certification levels

| Level | Meaning | Minimum outcome |
| --- | --- | --- |
| Bronze | Core functionality | Domain and contract behavior passes |
| Silver | Operational reliability | Runtime, recovery, performance, and observability pass |
| Gold | Healthcare readiness | Clinical, privacy, security, and human-review controls pass |
| Platinum | Enterprise certified | All RC1 gates, operations, DR, and required partner evidence pass |

Certification is per version and environment. A higher label requires all lower
levels. RC1 exit requires Platinum evidence for the production release boundary.

## Technical debt

Technical debt is classified as Critical, Major, Minor, or Cosmetic. Every item
records an owner, priority, risk, affected engine/workflow, target release,
acceptance criteria, and status.

- Critical debt blocks certification and receives immediate remediation.
- Major debt must be scheduled in the owning wave or explicitly accepted by the
  accountable authority.
- Minor and Cosmetic debt remain visible and cannot be used to conceal missing
  Definition of Done requirements.

## Engineering and product metrics

### Delivery

- Deployment frequency
- Lead time for change
- Change failure rate
- Mean time to recovery
- Certification score

### Workflow and clinical

- Workflow success rate
- Conversation completion rate
- Medicine-match accuracy
- Reservation success rate
- Clinical-review SLA
- Tenant-isolation incidents

### AI

- OCR and medicine-recognition accuracy
- Generic-match accuracy
- Recommendation acceptance and human-override rates
- Clinical confidence distribution

### Product

- Patients served and successful MARs
- Average time to medicine
- Reservation conversion and pickup completion
- Reminder engagement and refill rate

### Operations

- Availability, API latency, and error rate
- Queue backlog, retry rate, and dead-letter size
- Worker and database health
- Webhook success rate

Metrics require definitions, owners, dimensions, privacy controls, targets, and
alert thresholds. Counts alone are not certification.

## Repository lifecycle

Every certified wave is frozen. Changes to a frozen wave are limited to
security, production defects, compliance, performance, or an approved ADR.
Other work belongs to the next release.

Historical migrations, published contracts, and certification evidence remain
immutable. Corrections are additive and traceable.

## RC1 exit criteria

RC1 exits only when:

- All five waves are certified.
- The Enterprise Runtime Contract passes for every profile.
- The architecture conformance audit passes.
- Clinical and conversation workflows certify.
- The complete patient journey succeeds through WhatsApp without a website.
- Professional portals support their authorized operational users.
- Observability meets approved targets.
- Documentation and contracts are synchronized.
- No Critical certification or technical-debt item remains.

## RC2 entry criteria

RC2 starts only after RC1 certification and explicit scope approval. Candidate
priorities include SMS, USSD, native mobile, advanced analytics, population
health, external partner ecosystems, and expanded integrations.

RC2 reuses the same engines, workflows, APIs, runtime, and System of Record. A
candidate requiring core redesign must return to Level 1 governance.

## Standing implementation instructions

For every future batch:

1. Read `IMPLEMENTATION.md`.
2. Validate scope against `docs/release-scope.md`.
3. Follow `docs/ENTERPRISE_RUNTIME_CONTRACT.md`.
4. Respect accepted ADRs and this framework.
5. Preserve API compatibility, workflow identities, and event contracts.
6. Maintain tenant isolation and clinical safety.
7. Add required tests and evidence before certification.
8. Return the certification report required by `IMPLEMENTATION.md`.

## Execution handoff

The foundational governance phase is closed. The next engineering sequence is:

1. Complete the P0 items identified by S01.5.
2. Begin Wave 2.1 — Medicine Knowledge.
3. Implement and certify each approved batch incrementally.
