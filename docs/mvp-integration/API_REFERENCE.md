# RC1 API Reference

All APIs are versioned under `/api/v1`, authenticated, tenant-scoped, validated, authorized, and audited.

| Resource | Core operations |
| --- | --- |
| patient/prescription | upload and read lifecycle |
| review | create, retrieve, needs-information, approve |
| medicine/inventory | deterministic search and availability |
| reservations | reserve, retrieve, cancel/expire through runtime |
| notifications | list workflow notifications |
| workflow/MAR | create, retrieve, and timeline |
| AI/knowledge/audit | governed internal capabilities only |

Handlers must supply `IntegrationRequestContext`: `tenantId`, `subjectId`, `correlationId`, `idempotencyKey`, and `apiVersion: "v1"`. Stable DTOs live in `@medlink/api`; domain logic must not be duplicated in route handlers.
