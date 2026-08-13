# MedLink Lagos LGA Pilot Operations Playbook

Status: Draft until pilot owners and environment are approved.

## Entry criteria

- All twelve capability rows certified
- Five canonical workflows pass end to end
- Licensed pharmacists and pharmacies verified
- Pilot tenant, catalogue, inventory and support data approved
- Security, privacy, backup/restore, monitoring and incident validation pass
- WhatsApp/OCR/email providers conform and credentials are controlled
- UAT, training and clinical-safety acceptance complete

## Operating roles

Name accountable Pilot, Clinical, Pharmacy Network, Support, Security, Data,
Operations, Product and Executive leads. Publish on-call and escalation contacts
through approved secure channels.

## Launch

1. Confirm release, migrations, configuration and evidence.
2. Verify DNS/TLS, sessions, health, queues, providers and dashboards.
3. Seed only approved medicines, pharmacies, pharmacists and inventory.
4. Run synthetic prescription-to-fulfillment smoke.
5. Record launch authorization and activate hypercare.

## Hypercare and metrics

Monitor availability, API latency/errors, authentication failures, prescription
upload/OCR success, pharmacist queue time, search match rate, reservation
acceptance/expiry, notification delivery, fulfillment rate, incidents, MTTD and
MTTR. The North Star numerator and denominator must be defined before launch.

## Safety and support

Escalate clinical ambiguity to a licensed pharmacist. Never provide unapproved
AI output. Preserve prescription and incident evidence without exposing PHI.
Use approved rollback, queue, provider-outage, data-recovery and security
runbooks.

## Exit/review

Pilot completion requires agreed observation volume, stable operations, no open
critical safety/security issue, measured Successful Prescription Fulfillment
Rate, user/pharmacy feedback, incident review, and a signed pilot decision.
