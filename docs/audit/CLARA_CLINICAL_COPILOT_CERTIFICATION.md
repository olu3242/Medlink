# Clara Clinical Copilot Certification (Engine AG-04)

Date: 2026-08-01. Scope: Clara, the third real Agent SDK consumer after
Alice (AG-02) and Atlas (AG-03), per the evidence-grounded agent
sequence (Alice -> Atlas -> Clara) chosen explicitly over the Enterprise
Healthcare Intelligence Fabric superprompt earlier this session (a
speculative digital-twin/simulation layer with no live operational data
to ground it in). This document extends
`docs/audit/AGENT_SDK_CERTIFICATION.md` and
`docs/audit/AI_GATEWAY_CERTIFICATION.md`.

## Clara's role, and how it differs from Alice and Atlas

Alice is patient-facing and must refuse clinical questions. Atlas is
catalog-first and contacts the model only as a last resort. Clara is
**pharmacist-facing** -- her entire job is processing real clinical
content for a user who is already the licensed human decision-maker.
There is therefore no patient-bypass risk to guard against the way Alice
needs to; the safety property this pass actually needed to build was
different: **Clara never computes a clinical judgment of her own.** Every
capability takes an already-computed clinical artifact as input and
narrates it in plain language -- she adds no new clinical reasoning
anywhere.

- `summarize_prescription`'s `findings` input is the real
  `ValidationFinding[]` that `packages/clinical`'s
  `ClinicalValidationService` already produces
  (`DuplicateTherapyRule`, `PatientAllergyRule`, `PolypharmacyRiskRule`).
  Clara restates them; she does not re-run or reinterpret the clinical
  rules.
- `explain_equivalence_candidates`' `candidates` input is the real
  `EquivalencyCandidate[]` that `packages/medicine`'s
  `CatalogEquivalencyService.propose()` already computed (exact
  ingredient/strength/dosage-form/route matching, always
  `decision: "pharmacist_review_required"`, always
  `mayAutoSubstitute: false`). Clara explains what a candidate means; she
  never adds, removes, or re-ranks one.
- `draft_clarification_request` drafts text only. It does not send
  anything -- there is no delivery mechanism (G09 remains unbuilt,
  unchanged by this pass).

## The guardrail, reused and genuinely extended

`detectsClinicalDecisionLanguage()` (`alice-guardrail.ts`, built for
Alice) is reused directly against every one of Clara's generated
responses. For Clara this is not an escalation trigger the way it is for
Alice -- there is no one further up the chain to hand off to, the
pharmacist reading the output already is that person. Instead it becomes
an honest `advisoryLanguageFlag` on the result: a signal that the
generated phrasing itself reads as directive ("you should...") rather
than advisory ("consider..."), surfaced for the pharmacist rather than
silently accepted.

**Testing Clara against her actual domain (equivalence/substitution
explanations) found a real, narrow gap in the shared heuristic**: the
existing patterns were tuned against Alice's dosage-question domain and
did not catch substitution-directive language ("you should substitute
this medicine"). Three patterns were added to
`CLINICAL_DECISION_LANGUAGE_PATTERNS` to close it
(`you should substitute`, `should be substituted`,
`i recommend substituting`) -- a real fix driven by writing a real test
against a second real use case, not a speculative addition. This
strengthens the guardrail for Alice too, since it is the same shared
function.

## What was deliberately not built

- **No persistence.** Clara does not read from or write to any database
  table. Callers (a future route) are responsible for fetching
  `ValidationFinding[]`/`EquivalencyCandidate[]` from wherever they
  already live and supplying them as input -- consistent with every
  other agent's ports/adapters boundary in this package.
- **No route wiring**, same as Atlas -- no consuming
  `apps/*/app/api/v1/...` endpoint was specified.
- **No memory** (`memoryBoundary: "none"`) -- each capability call is
  independent; Clara does not remember a prior turn of the same review.
- **`needs_information` still has no real round-trip.**
  `draft_clarification_request` produces text a pharmacist can read and
  act on manually; it does not close the `needs_information` gap
  `CLINICAL_SAFETY_CERTIFICATION.md` and `CLINICAL_GOVERNANCE_REPORT.md`
  both already named -- that gap is about the platform having no
  mechanism to *deliver* a clarification and receive a patient's answer,
  which remains entirely unbuilt and is explicitly out of scope here.

## Test evidence

10 new tests in `clara.test.ts` covering all three capabilities
(including the zero-candidates case, which correctly never calls the AI
Gateway), the advisory-language flag tripping and not tripping, and role
denial. 3 new cases added to `alice-guardrail.test.ts` for the
substitution-language patterns. Full repository `npm run check`: see
verification section below.

## Relationship to RC1 pilot readiness

Additive and orthogonal, same as every other AI Platform document in this
program -- does not close any of the four items `GO_NO_GO_SUMMARY.md`
names. The RC1 pilot verdict is unchanged.

## What comes next

Per this session's explicit direction after this pass: not Quinn, not
Sage, not the Enterprise Healthcare Intelligence Fabric -- the next real
target is the minimal G09 notification slice `FINAL_GO_NO_GO.md` already
scoped (one real WhatsApp channel wired to `OutboxDispatcher` for one
real event), a genuine RC1 pilot-blocking gap rather than further
platform capability.
