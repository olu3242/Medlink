# Pharmacist app
API-only clinical review queue and human decision workspace. Automated flags and equivalents are advisory; the server enforces workflow, RBAC, acknowledgement, and audit policy.

**Status:** reads (`queue`/`review`) and the decision write now call the
correct cross-origin endpoints on `apps/patient` (`GET/PATCH
/api/v1/review[/{id}]`). Known gap: this app has no session of its own to
forward on those calls yet (Wave 4 portal authentication hasn't started),
so every call is effectively unauthenticated until that's built. See
`docs/audit/RC1_BACKLOG.md`.
