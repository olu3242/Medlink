-- Durable professional fulfillment transitions.
create table public.fulfillment_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reservation_id uuid not null references public.reservations(id),
  from_state text not null,
  to_state text not null,
  step text not null,
  idempotency_key text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index fulfillment_transitions_timeline_idx
  on public.fulfillment_transitions(organization_id, reservation_id, created_at);

alter table public.fulfillment_transitions enable row level security;

create policy fulfillment_transitions_professional_read
  on public.fulfillment_transitions for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array[
        'platform_admin', 'tenant_admin', 'pharmacist',
        'pharmacy_owner', 'pharmacy_staff', 'provider'
      ]::public.member_role[]
    )
  );

create trigger fulfillment_transitions_append_only
  before update or delete on public.fulfillment_transitions
  for each row execute function public.prevent_enterprise_event_mutation();
