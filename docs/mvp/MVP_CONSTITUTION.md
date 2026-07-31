# MedLink MVP Constitution

Version: 1.0
Status: Approved
Authority: Highest implementation authority for the MedLink MVP

If a prompt, roadmap, plan, or implementation instruction conflicts with this
constitution, this constitution prevails.

## 1. Mission

Enable patients to obtain prescribed medicines quickly, safely, and confidently
through licensed pharmacists and participating community pharmacies.

MedLink MVP is an AI-assisted, pharmacist-supervised prescription-fulfillment
product for one pilot LGA in Lagos State. It is not a general healthcare
platform.

## 2. North Star

The primary metric is **Successful Prescription Fulfillment Rate**. Every
feature must demonstrate how it improves or safely enables that metric.

## 3. Personas

The MVP supports only:

- Patient
- Pharmacist
- Pharmacy
- Administrator

An additional persona requires formal scope-change approval.

## 4. Capability delivery

A capability is complete only when every applicable element is delivered:

- Business rules and domain model
- Database and tenant isolation
- Versioned API and user interface
- Validation, authorization, audit, and observability
- AI and notifications where applicable
- Unit, integration, workflow, security, and acceptance evidence
- Documentation and deployability

Scaffolding is not completion.

## 5. Canonical workflows

All MVP behavior supports at least one of:

1. Prescription Intake
2. Clinical Review
3. Medicine Discovery
4. Reservation
5. Fulfillment

## 6. AI governance

AI may read prescriptions, extract medicine information, suggest catalogue-based
alternatives, flag potential interactions, explain output, and report
confidence.

AI may not diagnose, prescribe, approve or reject prescriptions, override a
pharmacist, autonomously change clinical state, or expose an unapproved clinical
recommendation to a patient.

## 7. Engineering and security

Every feature is secure, multi-tenant, authorized, validated, auditable,
observable, tested, documented, accessible where practical, and deployable.
Required controls include RBAC, RLS, encryption, secure sessions, file
validation/scanning, rate limiting, idempotency where needed, and safe errors.

## 8. Simplicity and architecture

Prefer the smallest clear design that completes the journey. Architecture is
modular, layered, domain-driven, and extensible, but speculative extension
behavior is prohibited.

## 9. Change control

MVP scope expansion requires written justification, North Star impact, risk and
delivery assessment, Product Owner approval, architecture review, and an ADR.
Without all five, the proposal moves to Post-MVP.

## 10. Permanently deferred scope

Unless this constitution is formally amended, MVP excludes FHIR/OpenHIE,
hospital/EMR integration, insurance, population health, national analytics or
exchange, marketplace, loyalty, referrals, procurement, delivery fleets,
supply-chain optimization, autonomous AI, advanced predictive analytics, and
multi-country deployment.

## 11. Success

MVP succeeds when a patient authenticates, uploads a prescription, receives
AI-assisted extraction followed by licensed-pharmacist approval, finds
participating stock, reserves medicine, receives pharmacy confirmation,
completes fulfillment, and can see an entirely secure, audited, observable
history.

## 12. Documentation hierarchy

1. MVP Constitution
2. Master Implementation Specification
3. ADRs
4. Capability Catalog and domain model
5. API and database specifications
6. Sprint backlog and test specification
7. Operations and user documentation

## MedLink principle

> Build the smallest, safest, and most reliable system that enables patients to
> obtain prescribed medicines through trusted pharmacists and community
> pharmacies.
