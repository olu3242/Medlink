-- Converge the existing MAR state machine with the canonical durable
-- WorkflowService store. A MAR UUID is also its medication-access workflow
-- UUID, so agents and lifecycle evidence share one stable correlation key.
create or replace function public.sync_medication_access_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workflow_status public.workflow_run_status := case
    when new.state = 'completed'::public.mar_status then 'completed'::public.workflow_run_status
    when new.state in ('cancelled', 'expired') then 'cancelled'::public.workflow_run_status
    else 'running'::public.workflow_run_status
  end;
begin
  insert into public.workflow_instances(
    id, organization_id, type, status, idempotency_key, completed_steps, context
  ) values (
    new.id,
    new.organization_id,
    'medication_access',
    workflow_status,
    'medication-access:' || new.id::text,
    array[new.state::text],
    jsonb_build_object(
      'marId', new.id,
      'patientId', new.patient_id,
      'prescriptionId', new.prescription_id,
      'medicineId', new.requested_medicine_id,
      'state', new.state
    )
  )
  on conflict (id) do update
  set status = excluded.status,
      completed_steps = case
        when excluded.completed_steps[1] = any(public.workflow_instances.completed_steps)
          then public.workflow_instances.completed_steps
        else array_append(
          public.workflow_instances.completed_steps,
          excluded.completed_steps[1]
        )
      end,
      context = public.workflow_instances.context || excluded.context;
  return new;
end;
$$;

insert into public.workflow_instances(
  id, organization_id, type, status, idempotency_key, completed_steps, context
)
select
  request.id,
  request.organization_id,
  'medication_access',
  case
    when request.state = 'completed'::public.mar_status then 'completed'::public.workflow_run_status
    when request.state in ('cancelled', 'expired') then 'cancelled'::public.workflow_run_status
    else 'running'::public.workflow_run_status
  end,
  'medication-access:' || request.id::text,
  coalesce((
    select array_agg(audit.to_state::text order by audit.occurred_at, audit.id)
    from public.mar_audit_events audit
    where audit.organization_id = request.organization_id
      and audit.mar_id = request.id
      and audit.to_state is not null
  ), array[request.state::text]),
  jsonb_build_object(
    'marId', request.id,
    'patientId', request.patient_id,
    'prescriptionId', request.prescription_id,
    'medicineId', request.requested_medicine_id,
    'state', request.state
  )
from public.medication_access_requests request
where request.deleted_at is null
on conflict (id) do nothing;

create trigger medication_access_workflow_sync
after insert or update of state on public.medication_access_requests
for each row execute function public.sync_medication_access_workflow();

-- Collection is the durable fulfillment event that continues the MAR from
-- reservation through dispensing to completion. It runs inside the same
-- collection transaction; any failure rolls the entire collection back.
create or replace function public.continue_medication_access_after_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_mar_id uuid;
  current_state public.mar_status;
begin
  if new.to_state <> 'collected' then return new; end if;

  select reservation.mar_id
  into target_mar_id
  from public.reservations reservation
  where reservation.id = new.reservation_id
    and reservation.organization_id = new.organization_id;
  if target_mar_id is null then
    raise exception 'Collected reservation has no medication access workflow';
  end if;

  select request.state
  into current_state
  from public.medication_access_requests request
  where request.id = target_mar_id
    and request.organization_id = new.organization_id
  for update;

  if current_state in ('reserved', 'paid') then
    update public.medication_access_requests
    set state = 'dispensed',
        transition_idempotency_key = new.idempotency_key || ':mar-dispensed'
    where id = target_mar_id and organization_id = new.organization_id;
    current_state := 'dispensed';
  end if;

  if current_state = 'dispensed' then
    update public.medication_access_requests
    set state = 'completed',
        completed_at = now(),
        transition_idempotency_key = new.idempotency_key || ':mar-completed'
    where id = target_mar_id and organization_id = new.organization_id;
    current_state := 'completed';
  end if;

  if current_state <> 'completed' then
    raise exception 'Collected reservation cannot complete MAR in state %', current_state;
  end if;

  perform public.record_runtime_evidence(
    new.organization_id,
    auth.uid(),
    'medication_access.complete',
    'success',
    new.correlation_id::text,
    new.idempotency_key,
    new.idempotency_key || ':medication-access-completed',
    'medication_access_request',
    target_mar_id::text,
    jsonb_build_object('state', 'dispensed'),
    jsonb_build_object('state', 'completed'),
    target_mar_id::text,
    null,
    'pharmacy_portal',
    'medication_access.completed.v1',
    jsonb_build_object(
      'marId', target_mar_id,
      'reservationId', new.reservation_id,
      'workflowId', target_mar_id
    )
  );
  return new;
end;
$$;

create trigger fulfillment_collection_workflow_continuation
after insert on public.fulfillment_transitions
for each row execute function public.continue_medication_access_after_collection();
