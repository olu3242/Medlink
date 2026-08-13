-- Keep selected public API relations discoverable through PostgREST while RLS
-- remains the authority that denies anonymous rows.
grant select on public.organizations to anon;
grant select on public.runtime_outbox_events to anon;
grant select on public.notification_outbox to anon;
grant select on public.notification_delivery_attempts to anon;
grant select on public.integration_webhook_messages to anon;
grant select on public.integration_delivery_attempts to anon;
grant select on public.api_client_credentials to anon;
