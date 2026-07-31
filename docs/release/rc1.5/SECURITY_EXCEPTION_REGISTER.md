# RC1.5 Security Exception Register

Status: **OPEN**

| Exception | Risk | Compensating control | Owner | Expiry | Approval |
| --- | --- | --- | --- | --- | --- |
| SEC-001 PostCSS transitive advisories | Crafted CSS/source-map processing may expose local files | Do not process tenant/user-supplied CSS; restrict build inputs; monitor advisory; validate patched override or framework update on a maintenance branch | Security Lead | Pending | Pending |
| SEC-002 Optional Sharp advisory | Vulnerable image-processing path if production invokes Sharp on attacker-controlled images | Prove Sharp omission in deployment or restrict/validate image inputs; plan compatible remediation | Security Lead | Pending | Pending |
| SEC-003 Development toolchain advisories | Crafted repository patterns could exhaust CI resources | Trusted contributors, protected branches, bounded CI resources, no runtime deployment of toolchain | Engineering Lead | Pending | Pending |
| SEC-004 Security-header evidence absent | Browser hardening cannot be certified | Apply and verify approved CSP/HSTS/frame/MIME/referrer policy at application or edge | Security Lead | Pending | Pending |
| SEC-005 Rate-limit evidence absent | Public/API abuse and authentication exhaustion risk | Document edge/application throttling, thresholds, bypass protection, monitoring, and test results | Operations Lead | Pending | Pending |
| SEC-006 Independent penetration test absent | Deployed attack paths have not been independently assessed | GA remains blocked | Executive Release Authority | Pending | Not accepted |
| SEC-007 Authenticated tenant-isolation exercise absent | Cross-tenant access remains incompletely demonstrated | GA remains blocked; execute designated identity matrix | Security Lead | Pending | Not accepted |

An exception becomes valid only with a named accountable owner, explicit
decision, expiry, conditions, evidence SHA-256, and signature. No entry above is
currently accepted.

