# RC1 General Availability Release Package

Date: 2026-07-30  
Release candidate: `v1.0.0-rc1`  
Commit: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Package status: **INCOMPLETE — NOT AUTHORIZED FOR GA**

## Package index

- Engineering certification: repository test/build evidence and
  `docs/audit/EXTERNAL_CLOSURE_STATUS_2026-07-29.md`
- Security: `SECURITY_CERTIFICATION.md`
- Reliability: `RELIABILITY_CERTIFICATION.md`
- Data integrity: `DATA_CERTIFICATION.md`
- Deployment: `DEPLOYMENT_CERTIFICATION.md`
- Backup/DR: `DR_CERTIFICATION.md`
- Dependencies: `DEPENDENCY_RISK_REGISTER.md`
- Freeze: `RC1_FREEZE_REPORT.md`
- Decision: `GA_DECISION.md`
- Conditional RC2 plan: `RC2_EXECUTION_PLAN.md`

## Engineering evidence

- Exact dependency installation completed.
- Lint and strict TypeScript passed.
- 280 engineering tests passed.
- Eight hosted Supabase/RLS tests passed.
- All eight application builds passed.
- `/`, `/health/live`, `/health/ready`, and `/api/v1/health` returned HTTP 200.
- No production code change was necessary for readiness.

## Known issues and risks

1. Fifteen high npm findings, including production-profile PostCSS and optional
   Sharp, require signed disposition.
2. No independent deployed-target penetration assessment.
3. No managed encrypted backup, isolated data restore, PITR, or regional DR
   exercise.
4. Authenticated cross-tenant isolation evidence remains incomplete.
5. Provider conformance for OCR, WhatsApp, payment, FHIR/HL7, and approved
   partners remains pending.
6. Security header, rate-limit, environment-parity, deployment, rollback, load,
   monitoring, hypercare, and support execution evidence remains pending.
7. Required clinical, privacy, security, operations, product, and executive
   approvals have not been recorded.

## Rollback and support

Deployment/rollback, dependency outage, queue backlog, dead-letter, SLO breach,
and enterprise operations runbooks exist. Production owners, on-call roster,
escalation contacts, maintenance window, rollback exercise record, and hypercare
schedule must be attached before approval.

## Release recommendation

**NO-GO pending external operational evidence and human approvals.**

