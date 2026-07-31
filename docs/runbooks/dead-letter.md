# Dead-letter recovery

1. Group dead letters by event type, error code, tenant, and deployment.
2. Remove secrets and clinical content from investigation exports.
3. Fix or register the responsible consumer before replay.
4. Replay with the original event and idempotency identifiers.
5. Confirm the side effect once, then record recovery evidence.
