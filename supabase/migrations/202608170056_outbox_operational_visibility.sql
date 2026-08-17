-- Tenant-scoped operational visibility over the canonical runtime outbox.
-- Returns aggregates only: never event payloads, recipient data, or records
-- from another organization.
create or replace function public.runtime_outbox_operational_state(
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.has_organization_role(
       target_organization_id,
       array[
         'platform_admin', 'tenant_admin', 'pharmacy_owner'
       ]::public.member_role[]
     )
  then
    raise exception 'Outbox operational visibility requires an administrative role'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organizationId', target_organization_id,
    'pendingCount', count(*) filter (
      where event.status = 'pending'::public.runtime_event_status
    ),
    'retryingCount', count(*) filter (
      where event.status = 'retrying'::public.runtime_event_status
    ),
    'deadLetterCount', count(*) filter (
      where event.status = 'dead_letter'::public.runtime_event_status
    ),
    'oldestPendingAt', min(event.created_at) filter (
      where event.status in (
        'pending'::public.runtime_event_status,
        'retrying'::public.runtime_event_status
      )
    ),
    'lastWorkerRunAt', max(event.locked_at),
    'lastSuccessAt', max(event.published_at),
    'lastFailureAt', max(coalesce(event.locked_at, event.created_at)) filter (
      where event.last_error_code is not null
    )
  )
  into result
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id;

  return result;
end;
$$;

revoke all on function public.runtime_outbox_operational_state(uuid)
  from public, anon;
grant execute on function public.runtime_outbox_operational_state(uuid)
  to authenticated, service_role;
