# MedLink Developer Portal
Independent API client, webhook, documentation, and enterprise integration status UI. Set `MEDLINK_API_URL` for server reads and deploy behind the API gateway for mutations.

The portal deliberately discards any `secret` or `clientSecret` fields returned during client creation and renders only masked key prefixes. Secure credential delivery and storage are backend/platform responsibilities.

**Status:** UI scaffold. Its four API routes (`developer/clients`,
`developer/webhooks`, `developer/webhook-deliveries`, `integrations`) don't
exist anywhere in the repository yet (Wave 5 - Partner Integrations - hasn't
started). See `docs/audit/RC1_BACKLOG.md`.
