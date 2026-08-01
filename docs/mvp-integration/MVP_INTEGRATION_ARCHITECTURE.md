# MedLink MVP Integration Architecture

## RC1 scope

The integration fabric supports one governed path: patient -> WhatsApp/prescription -> pharmacist review -> deterministic medicine search -> tenant inventory -> atomic reservation -> WhatsApp notification. Domain packages own business rules; `@medlink/integrations` owns provider boundaries and certification metadata. All calls carry tenant, subject, correlation, idempotency, and API-version context.

## Boundaries

| Capability | System of record | Integration boundary |
| --- | --- | --- |
| Identity/RBAC | Supabase + `@medlink/platform` | validated request context |
| Conversation | `@medlink/conversation` | `@medlink/whatsapp` provider |
| Documents | private object storage | `PrivateDocumentStore` |
| Clinical AI | `@medlink/ai` | governed gateway only |
| Medicine/search | `@medlink/medicine`, `@medlink/search` | deterministic before AI |
| Inventory/reservation | domain services + Postgres | tenant-scoped ports and atomic RPC |
| Notification | `@medlink/notifications` | WhatsApp-first channel |
| Runtime/audit | `@medlink/runtime` + outbox/evidence tables | correlation and idempotency |

RC2 integrations listed in `rc2ExcludedIntegrations` are not enabled.
