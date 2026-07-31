-- Wave 3: Medication Access Core
-- Static invariants:
--   * Every tenant relationship uses an organization-scoped composite FK.
--   * MAR state changes are validated and recorded in an append-only audit table.
--   * Active inventory locks are reflected in batch quantity_reserved atomically.
--   * Only pharmacists may finalize clinical reviews.

create type public.mar_status as enum (
  'created', 'validated', 'reviewed', 'searching', 'matched', 'reserved',
  'paid', 'dispensed', 'completed', 'cancelled', 'expired'
);

create type public.inventory_batch_status as enum (
  'available', 'quarantined', 'recalled', 'depleted', 'expired'
);

create type public.clinical_review_decision as enum (
  'pending', 'approved', 'rejected', 'needs_information'
);

create type public.reservation_status as enum (
  'pending', 'confirmed', 'ready', 'collected', 'cancelled', 'expired'
);

create type public.inventory_lock_status as enum (
  'active', 'consumed', 'released', 'expired'
);

create table public.pharmacy_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (char_length(name) between 2 and 200),
  license_number text,
  address_line_1 text not null,
  address_line_2 text,
  locality text not null,
  administrative_area text,
  postal_code text,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  phone text,
  is_active boolean not null default true,
  is_24_hours boolean not null default false,
  supports_emergency_service boolean not null default false,
  operating_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id)
);

create unique index pharmacy_locations_license_unique_idx
  on public.pharmacy_locations(country_code, license_number)
  where license_number is not null and deleted_at is null;
create index pharmacy_locations_org_idx
  on public.pharmacy_locations(organization_id)
  where deleted_at is null;
-- PostgreSQL point/GiST keeps nearest-location queries index-ready without
-- committing the schema to PostGIS. A future geography adapter can coexist.
create index pharmacy_locations_coordinates_gist_idx
  on public.pharmacy_locations using gist (
    point(longitude::double precision, latitude::double precision)
  )
  where deleted_at is null and is_active;

create table public.medication_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  patient_id uuid not null references auth.users(id),
  prescription_id uuid,
  requested_medicine_id uuid references public.medicines(id),
  state public.mar_status not null default 'created',
  patient_notes text,
  cancellation_reason text,
  transition_idempotency_key text not null
    check (btrim(transition_idempotency_key) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (id, organization_id, patient_id),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id),
  check (
    state not in ('completed', 'cancelled', 'expired')
    or completed_at is not null
  )
);

create index medication_access_requests_patient_idx
  on public.medication_access_requests(patient_id, created_at desc)
  where deleted_at is null;
create index medication_access_requests_org_queue_idx
  on public.medication_access_requests(organization_id, state, created_at)
  where deleted_at is null;

create table public.mar_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  mar_id uuid not null,
  event_type text not null check (char_length(event_type) between 3 and 100),
  from_state public.mar_status,
  to_state public.mar_status,
  actor_id uuid references auth.users(id),
  idempotency_key text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (mar_id, organization_id)
    references public.medication_access_requests(id, organization_id)
    deferrable initially deferred
);

create unique index mar_audit_events_idempotency_idx
  on public.mar_audit_events(organization_id, idempotency_key)
  where idempotency_key is not null;
create index mar_audit_events_mar_timeline_idx
  on public.mar_audit_events(mar_id, occurred_at, id);
create index mar_audit_events_org_timeline_idx
  on public.mar_audit_events(organization_id, occurred_at desc);

create or replace function public.prevent_mar_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'MAR audit events are append-only';
end;
$$;

create trigger mar_audit_events_append_only
before update or delete on public.mar_audit_events
for each row execute function public.prevent_mar_audit_mutation();

create or replace function public.enforce_and_audit_mar_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transition_allowed boolean;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'created'::public.mar_status then
      raise exception 'A MAR must begin in created state';
    end if;

    insert into public.mar_audit_events (
      organization_id, mar_id, event_type, to_state, actor_id,
      idempotency_key, metadata
    ) values (
      new.organization_id, new.id, 'MAR.Created', new.state, auth.uid(),
      new.transition_idempotency_key, '{}'::jsonb
    );
    return new;
  end if;

  if new.organization_id <> old.organization_id
     or new.patient_id <> old.patient_id
     or new.created_by <> old.created_by then
    raise exception 'MAR ownership fields are immutable';
  end if;

  if new.state = old.state then
    return new;
  end if;

  if new.transition_idempotency_key is null
     or btrim(new.transition_idempotency_key) = '' then
    raise exception 'A state transition requires an idempotency key';
  end if;

  transition_allowed := case old.state
    when 'created' then new.state in ('validated', 'cancelled')
    when 'validated' then new.state in ('reviewed', 'cancelled')
    when 'reviewed' then new.state in ('searching', 'cancelled')
    when 'searching' then new.state in ('matched', 'cancelled', 'expired')
    when 'matched' then new.state in ('reserved', 'searching', 'cancelled', 'expired')
    when 'reserved' then new.state in ('paid', 'dispensed', 'cancelled', 'expired')
    when 'paid' then new.state in ('dispensed', 'cancelled')
    when 'dispensed' then new.state in ('completed')
    else false
  end;

  if not transition_allowed then
    raise exception 'Illegal MAR transition from % to %', old.state, new.state;
  end if;

  if new.state = 'reviewed'
     and not exists (
       select 1
       from public.clinical_reviews review
       where review.mar_id = new.id
         and review.organization_id = new.organization_id
         and review.decision = 'approved'
     ) then
    raise exception 'MAR cannot enter reviewed state without pharmacist approval';
  end if;

  if new.state in ('completed', 'cancelled', 'expired')
     and new.completed_at is null then
    new.completed_at = now();
  end if;

  insert into public.mar_audit_events (
    organization_id, mar_id, event_type, from_state, to_state, actor_id,
    idempotency_key, metadata
  ) values (
    new.organization_id, new.id, 'MAR.StateChanged', old.state, new.state,
    auth.uid(), new.transition_idempotency_key, '{}'::jsonb
  );

  return new;
end;
$$;

create trigger medication_access_requests_state_guard
before insert or update on public.medication_access_requests
for each row execute function public.enforce_and_audit_mar_state();

create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  pharmacy_location_id uuid not null,
  medicine_id uuid not null references public.medicines(id),
  batch_number text not null check (char_length(batch_number) between 1 and 120),
  expires_on date not null,
  quantity_on_hand integer not null check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  available_quantity integer generated always as
    (quantity_on_hand - quantity_reserved) stored,
  unit text not null check (char_length(unit) between 1 and 40),
  status public.inventory_batch_status not null default 'available',
  acquisition_cost_minor bigint check (acquisition_cost_minor is null or acquisition_cost_minor >= 0),
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (pharmacy_location_id, medicine_id, batch_number),
  foreign key (pharmacy_location_id, organization_id)
    references public.pharmacy_locations(id, organization_id),
  check (quantity_reserved <= quantity_on_hand)
);

create index inventory_batches_lookup_idx
  on public.inventory_batches(pharmacy_location_id, medicine_id, expires_on)
  where deleted_at is null
    and status = 'available'
    and quantity_on_hand > quantity_reserved;
create index inventory_batches_expiry_idx
  on public.inventory_batches(organization_id, expires_on)
  where deleted_at is null and status in ('available', 'quarantined');
create index inventory_batches_medicine_idx
  on public.inventory_batches(medicine_id, pharmacy_location_id)
  where deleted_at is null and status = 'available';

create table public.clinical_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mar_id uuid not null,
  prescription_id uuid,
  decision public.clinical_review_decision not null default 'pending',
  recommendation text,
  intervention text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (mar_id, organization_id)
    references public.medication_access_requests(id, organization_id),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id),
  check (
    (decision = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (decision <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index clinical_reviews_queue_idx
  on public.clinical_reviews(organization_id, decision, created_at);
create index clinical_reviews_mar_idx
  on public.clinical_reviews(mar_id, created_at desc);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mar_id uuid not null,
  patient_id uuid not null references auth.users(id),
  pharmacy_location_id uuid not null,
  status public.reservation_status not null default 'pending',
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  pickup_code_hash text,
  pickup_window_starts_at timestamptz,
  pickup_window_ends_at timestamptz,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, patient_id),
  unique (organization_id, idempotency_key),
  foreign key (mar_id, organization_id, patient_id)
    references public.medication_access_requests(id, organization_id, patient_id),
  foreign key (pharmacy_location_id, organization_id)
    references public.pharmacy_locations(id, organization_id),
  check (pickup_window_ends_at is null
    or pickup_window_starts_at is null
    or pickup_window_ends_at > pickup_window_starts_at),
  check (expires_at > created_at)
);

create index reservations_patient_idx
  on public.reservations(patient_id, created_at desc);
create index reservations_location_queue_idx
  on public.reservations(pharmacy_location_id, status, expires_at)
  where status in ('pending', 'confirmed', 'ready');
create unique index reservations_one_open_per_mar_idx
  on public.reservations(mar_id)
  where status in ('pending', 'confirmed', 'ready');

create table public.inventory_locks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reservation_id uuid not null,
  inventory_batch_id uuid not null,
  quantity integer not null check (quantity > 0),
  status public.inventory_lock_status not null default 'active',
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (reservation_id, inventory_batch_id),
  foreign key (reservation_id, organization_id)
    references public.reservations(id, organization_id) on delete restrict,
  foreign key (inventory_batch_id, organization_id)
    references public.inventory_batches(id, organization_id) on delete restrict,
  check (expires_at > created_at),
  check (
    (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status in ('released', 'expired')
      and released_at is not null and consumed_at is null)
    or (status = 'active' and consumed_at is null and released_at is null)
  )
);

create index inventory_locks_expiry_idx
  on public.inventory_locks(expires_at)
  where status = 'active';
create index inventory_locks_reservation_idx
  on public.inventory_locks(reservation_id);

create or replace function public.sync_inventory_lock_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_active_quantity integer := 0;
  new_active_quantity integer := 0;
  consumed_quantity integer := 0;
  quantity_delta integer;
  target_batch uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Inventory locks cannot be deleted; release or expire them';
  end if;

  if tg_op = 'UPDATE'
     and (new.organization_id <> old.organization_id
       or new.inventory_batch_id <> old.inventory_batch_id
       or new.reservation_id <> old.reservation_id) then
    raise exception 'Inventory lock ownership fields are immutable';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'active'
     and new.status <> old.status then
    raise exception 'A finalized inventory lock cannot transition again';
  end if;

  if tg_op = 'UPDATE' and old.status = 'active'
     and new.status not in ('active', 'consumed', 'released', 'expired') then
    raise exception 'Invalid inventory lock transition';
  end if;

  if tg_op = 'UPDATE' and old.status = 'active'
     and new.status <> 'active' and new.quantity <> old.quantity then
    raise exception 'Lock quantity cannot change while finalizing';
  end if;

  if tg_op = 'UPDATE' and old.status = 'active' then
    old_active_quantity := old.quantity;
  end if;
  if new.status = 'active' then
    new_active_quantity := new.quantity;
  end if;

  quantity_delta := new_active_quantity - old_active_quantity;
  if tg_op = 'UPDATE' and old.status = 'active'
     and new.status = 'consumed' then
    consumed_quantity := old.quantity;
  end if;
  target_batch := new.inventory_batch_id;

  if quantity_delta <> 0 or consumed_quantity <> 0 then
    update public.inventory_batches
    set quantity_on_hand = quantity_on_hand - consumed_quantity,
        quantity_reserved = quantity_reserved + quantity_delta,
        updated_at = now()
    where id = target_batch
      and organization_id = new.organization_id
      and deleted_at is null
      and (
        (quantity_delta <= 0 and consumed_quantity = 0)
        or (status = 'available' and expires_on >= current_date)
      )
      and quantity_on_hand - consumed_quantity >= 0
      and quantity_reserved + quantity_delta between 0
        and quantity_on_hand - consumed_quantity;

    if not found then
      raise exception 'Insufficient or unavailable inventory for lock';
    end if;
  end if;

  return new;
end;
$$;

create trigger inventory_locks_quantity_guard
before insert or update or delete on public.inventory_locks
for each row execute function public.sync_inventory_lock_quantity();

create or replace function public.protect_inventory_reserved_quantity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity_reserved <> old.quantity_reserved
     and pg_trigger_depth() < 2 then
    raise exception 'quantity_reserved is maintained only by inventory locks';
  end if;
  return new;
end;
$$;

create trigger inventory_batches_reserved_guard
before update on public.inventory_batches
for each row execute function public.protect_inventory_reserved_quantity();

create or replace function public.prevent_final_clinical_review_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Clinical reviews cannot be deleted';
  end if;
  if old.decision <> 'pending'::public.clinical_review_decision then
    raise exception 'A finalized clinical review is immutable';
  end if;
  return new;
end;
$$;

create trigger clinical_reviews_final_guard
before update or delete on public.clinical_reviews
for each row execute function public.prevent_final_clinical_review_mutation();

create trigger pharmacy_locations_set_updated_at
before update on public.pharmacy_locations
for each row execute function public.set_updated_at();
create trigger medication_access_requests_set_updated_at
before update on public.medication_access_requests
for each row execute function public.set_updated_at();
create trigger inventory_batches_set_updated_at
before update on public.inventory_batches
for each row execute function public.set_updated_at();
create trigger clinical_reviews_set_updated_at
before update on public.clinical_reviews
for each row execute function public.set_updated_at();
create trigger reservations_set_updated_at
before update on public.reservations
for each row execute function public.set_updated_at();
create trigger inventory_locks_set_updated_at
before update on public.inventory_locks
for each row execute function public.set_updated_at();

alter table public.pharmacy_locations enable row level security;
alter table public.medication_access_requests enable row level security;
alter table public.mar_audit_events enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.clinical_reviews enable row level security;
alter table public.reservations enable row level security;
alter table public.inventory_locks enable row level security;

create policy pharmacy_locations_discovery_read
  on public.pharmacy_locations for select to authenticated
  using (deleted_at is null and is_active);
create policy pharmacy_locations_manage
  on public.pharmacy_locations for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner']::public.member_role[]
  ));

create policy medication_access_requests_read
  on public.medication_access_requests for select to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin', 'pharmacist',
            'pharmacy_owner', 'pharmacy_staff']::public.member_role[]
    )
  );
create policy medication_access_requests_create
  on public.medication_access_requests for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_organization_member(organization_id)
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id,
        array['pharmacist', 'pharmacy_staff']::public.member_role[]
      )
    )
  );
create policy medication_access_requests_update
  on public.medication_access_requests for update to authenticated
  using (public.has_organization_role(
    organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ));

create policy mar_audit_events_read
  on public.mar_audit_events for select to authenticated
  using (
    exists (
      select 1
      from public.medication_access_requests mar
      where mar.id = mar_id
        and (mar.patient_id = auth.uid()
          or public.has_organization_role(
            mar.organization_id,
            array['platform_admin', 'tenant_admin', 'pharmacist',
                  'pharmacy_owner', 'pharmacy_staff']::public.member_role[]
          ))
    )
  );
-- Inserts are performed only by the security-definer MAR transition trigger.

create policy inventory_batches_member_read
  on public.inventory_batches for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ));
create policy inventory_batches_manage
  on public.inventory_batches for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ));

create policy clinical_reviews_member_read
  on public.clinical_reviews for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
    or exists (
      select 1
      from public.medication_access_requests mar
      where mar.id = mar_id and mar.patient_id = auth.uid()
    )
  );
create policy clinical_reviews_pharmacist_manage
  on public.clinical_reviews for all to authenticated
  using (public.has_organization_role(
    organization_id, array['pharmacist']::public.member_role[]
  ))
  with check (
    public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
    and (decision = 'pending' or reviewed_by = auth.uid())
  );

create policy reservations_read
  on public.reservations for select to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin', 'pharmacist',
            'pharmacy_owner', 'pharmacy_staff', 'inventory_manager']::public.member_role[]
    )
  );
create policy reservations_create
  on public.reservations for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_organization_member(organization_id)
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id,
        array['pharmacist', 'pharmacy_staff']::public.member_role[]
      )
    )
  );
create policy reservations_manage
  on public.reservations for update to authenticated
  using (public.has_organization_role(
    organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ));

create policy inventory_locks_member_read
  on public.inventory_locks for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ));
create policy inventory_locks_manage
  on public.inventory_locks for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['pharmacist', 'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['pharmacist', 'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ));

comment on table public.pharmacy_locations is
  'Contains pharmacy contact/address PII and geospatial discovery coordinates. Active locations are discoverable by authenticated users.';
comment on table public.medication_access_requests is
  'Contains PHI linking a patient, prescription, requested medicine, and workflow state. State changes are audited automatically.';
comment on table public.mar_audit_events is
  'Append-only clinical workflow audit. UPDATE and DELETE are blocked even for roles that bypass RLS.';
comment on column public.mar_audit_events.metadata is
  'May contain PHI. Store structured identifiers and reasons only; never copy prescription documents or secrets.';
comment on table public.inventory_batches is
  'Tenant inventory by physical batch and expiry. quantity_reserved is maintained by inventory-lock triggers.';
comment on column public.inventory_batches.acquisition_cost_minor is
  'Commercially sensitive tenant data expressed in minor currency units.';
comment on table public.clinical_reviews is
  'Contains PHI and pharmacist clinical judgment. Non-pending decisions require pharmacist identity and timestamp.';
comment on table public.reservations is
  'Contains PHI/PII linking a patient and medication-access workflow to a pickup location.';
comment on column public.reservations.pickup_code_hash is
  'Hashed pickup credential only. Plaintext pickup codes must never be stored.';
comment on table public.inventory_locks is
  'Atomic reservation allocation. Active quantities are reflected in inventory_batches.quantity_reserved.';
