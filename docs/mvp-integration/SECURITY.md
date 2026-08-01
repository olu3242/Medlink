# Integration Security

Controls include JWT validation, role authorization, tenant isolation, webhook HMAC verification, replay protection, idempotency, private storage, least-privilege credentials, rate limiting at the edge, structured security logs, and immutable runtime evidence. Secrets are server-only and sourced from environment/secret management. Rotate any credential exposed in source history. Production sign-off requires deployment-specific RLS, rate-limit, alert, secret-rotation, and penetration-test evidence.
