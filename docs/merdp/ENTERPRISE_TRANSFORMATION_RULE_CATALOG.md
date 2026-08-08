# Enterprise Transformation Rule Catalog (ETRC)

## Rule contract

All source-to-canonical transformations use approved, versioned rules. A rule
contains ID, version, status, owner, reviewer, source/target schema versions,
effective period, priority, condition, typed operation, parameters, output,
reason, test fixtures, safety classification, and rollback version.

```ts
interface TransformationRule {
  ruleId: `TR-${string}`;
  version: string;
  status: "draft" | "approved" | "active" | "retired";
  sourceSchema: SchemaReference;
  targetSchema: SchemaReference;
  condition: DeclarativeExpression;
  operation: string;
  parameters: Readonly<Record<string, unknown>>;
  effectiveFrom: string;
  effectiveTo?: string;
  owner: string;
  approvalId: string;
  fixtureIds: readonly string[];
}
```

## Initial rule classes

| Rule ID | Class | Purpose | Safety |
| --- | --- | --- | --- |
| TR-MAP-001 | field mapping | Map regulator fields to canonical candidates | standard |
| TR-NAME-001 | display normalization | Unicode/whitespace normalization without identity loss | standard |
| TR-SUB-001 | substance relation | Propose salt/base relationship while retaining both concepts | clinical review |
| TR-UNIT-001 | unit conversion | Convert only dimensionally compatible governed units | hard fail on ambiguity |
| TR-FORM-001 | vocabulary mapping | Map source dosage form to certified concept | review when unmapped |
| TR-ROUTE-001 | vocabulary mapping | Map source route to certified concept | review when ambiguous |
| TR-ORG-001 | organization preparation | Normalize legal suffix for matching, preserve display value | standard |
| TR-REG-001 | authorization mapping | Preserve regulator number, status, jurisdiction, dates | critical |

Examples such as “Rosuvastatin Calcium → Rosuvastatin” are not destructive
string replacements. They create a proposed typed salt/base relationship and
retain the supplied substance identity and original expression.

## Execution rules

- Rules are deterministic unless explicitly classified as advisory.
- Advisory or AI output creates a candidate, never a certified value.
- Every output field records rule ID/version and input assertion references.
- Unconsumed required fields, ambiguous conversions, and clinical hard stops
  produce typed exceptions.
- Rule ordering is explicit; conflicting writes fail rather than depend on
  storage or iteration order.
- Arbitrary SQL, JavaScript, prompts, and network calls are forbidden inside a
  declarative rule.

## Governance workflow

```text
draft -> peer_review -> clinical_review (when applicable) -> approved
-> shadow -> active -> deprecated -> retired
```

Activation requires fixtures, regression comparison, impact counts, rollback,
and approval segregation. Emergency rules expire automatically and require
retrospective review.

## Certification

Each bundle proves schema compatibility, fixture coverage, deterministic replay,
zero unexplained row/field loss, provenance completeness, bounded performance,
and absence of unresolved critical exceptions. Bundle manifests record ordered
rule versions and checksum. Reprocessing always names the bundle used.
