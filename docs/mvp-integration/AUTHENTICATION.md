# Authentication and Authorization

Supabase owns user sessions and JWT issuance. `@medlink/platform` validates request context, resolves the tenant, and enforces the role-permission matrix for patient, pharmacist, pharmacy staff/owner, tenant administrator, and platform administrator. Agent calls use a system subject but remain tenant-scoped and auditable. API handlers must reject missing tenant, correlation, idempotency, or v1 version context before invoking domain services.
