-- G09 minimum slice (FINAL_GO_NO_GO.md, closable item 3): "one real
-- NotificationChannel (WhatsApp, since GraphApiWhatsAppSender already
-- exists and is tested) plus wiring OutboxDispatcher to at least one real
-- event." packages/workflows' OutboxDispatcher/OutboxStore already exist
-- and runtime_outbox_events (migration 202607270006) is already populated
-- by every use case via record_runtime_evidence() -- what was missing was
-- a worker-safe way to atomically claim rows off that table. This is the
-- only schema change this slice needs: OutboxDispatcher's published/retry/
-- deadLetter operations are simple single-row updates a service-role
-- client can already perform (RLS is bypassed for that role, and there is
-- deliberately no authenticated write policy on this table, same as
-- notification_outbox/notification_delivery_attempts' documented
-- "worker-only through the service role" pattern). The one operation that
-- genuinely cannot be expressed as a plain client call is claim(): picking
-- up to N unclaimed rows and locking them against a second, concurrent
-- worker needs FOR UPDATE SKIP LOCKED inside a function.

create or replace function public.claim_runtime_outbox_events(
  target_worker text,
  target_limit integer default 50
)
returns setof public.runtime_outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_worker is null or btrim(target_worker) = '' then
    raise exception 'target_worker is required';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 200 then
    raise exception 'target_limit must be between 1 and 200';
  end if;

  return query
    update public.runtime_outbox_events
    set status = 'publishing', locked_by = target_worker, locked_at = now()
    where id in (
      select id from public.runtime_outbox_events
      where status in ('pending', 'retrying') and available_at <= now()
      order by created_at
      limit target_limit
      for update skip locked
    )
    returning *;
end;
$$;

-- Worker-only, mirroring notification_outbox's documented convention:
-- authenticated end users have no legitimate reason to lock outbox rows,
-- and this function's SECURITY DEFINER body would otherwise let any
-- authenticated caller do so.
revoke all on function public.claim_runtime_outbox_events(text, integer)
  from public;
grant execute on function public.claim_runtime_outbox_events(text, integer)
  to service_role;

comment on function public.claim_runtime_outbox_events(text, integer) is
  'Atomically claims up to target_limit pending/retrying outbox rows for target_worker (FOR UPDATE SKIP LOCKED). Service-role only -- the dispatch worker''s only entry point onto runtime_outbox_events beyond the plain updates published()/retry()/deadLetter() already perform directly.';

-- G09 reconciliation (post PR#26): the fulfillment RPCs' own
-- record_runtime_evidence() calls already emit reservation.{confirmed,
-- cancelled,ready,collected}.v1 events with aggregate_type='reservation'
-- and aggregate_id=<reservation id> -- readable by the same worker via the
-- reservations grant PR#26 already added. No further schema change is
-- needed for the notification consumers in packages/notifications/src/
-- reservation-outbox.ts to resolve a recipient patient from those events.
