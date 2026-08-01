# WhatsApp Integration

Inbound messages are signature-verified, normalized, idempotently claimed, tenant-resolved, consent-checked, and routed through `WhatsAppJourney`. Images and documents are downloaded through the provider port. Outbound replies use a stable idempotency key. Provider delivery-status persistence and production webhook registration require Meta credentials and deployment evidence.

Required secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_VERIFY_TOKEN`. Never expose them as `NEXT_PUBLIC_*`.
