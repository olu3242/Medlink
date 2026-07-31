-- Wave 4: Experience and Intelligence
-- Static invariants:
--   * Payment data stores provider references only, never card credentials.
--   * Delivery, payment, adherence, analytics, and AI audit events are append-only.
--   * Analytics events contain aggregate-ready dimensions, not direct identifiers.
--   * AI recommendations always require an attributed human review.

create type public.notification_channel as enum (
  'in_app', 'email', 'sms', 'whatsapp', 'push'
);

create type public.notification_status as enum (
  'queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled'
);

create type public.delivery_attempt_status as enum (
  'accepted', 'delivered', 'temporary_failure', 'permanent_failure'
);

create type public.payment_status as enum (
  'pending', 'authorized', 'captured', 'failed', 'cancelled', 'refunded',
  'partially_refunded'
);

create type public.refund_status as enum (
  'pending', 'succeeded', 'failed', 'cancelled'
);

create type public.adherence_schedule_status as enum (
  'active', 'paused', 'completed', 'cancelled'
);

create type public.adherence_event_kind as enum (
  'scheduled', 'taken', 'missed', 'skipped', 'snoozed'
);

create type public.ai_run_status as enum (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  recipient_id uuid not null references auth.users(id),
  channel public.notification_channel not null,
  template_key text not null check (char_length(template_key) between 2 and 160),
  template_version text not null,
  locale text not null default 'en',
  subject text,
  template_variables jsonb not null default '{}'::jsonb,
  status public.notification_status not null default 'queued',
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  correlation_id text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key)
);

create index notifications_recipient_idx
  on public.notifications(recipient_id, created_at desc);
create index notifications_dispatch_queue_idx
  on public.notifications(status, scheduled_for, created_at)
  where status in ('queued', 'processing');
create index notifications_org_status_idx
  on public.notifications(organization_id, status, created_at desc);

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  notification_id uuid not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  status public.notification_status not null default 'queued',
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (notification_id),
  foreign key (notification_id, organization_id)
    references public.notifications(id, organization_id) on delete restrict
);

create index notification_outbox_worker_idx
  on public.notification_outbox(available_at, id)
  where status = 'queued';
create index notification_outbox_stale_lock_idx
  on public.notification_outbox(locked_at)
  where status = 'processing';

create table public.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  notification_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  provider text not null,
  provider_message_reference text,
  status public.delivery_attempt_status not null,
  response_code text,
  error_code text,
  error_detail text,
  attempted_at timestamptz not null default now(),
  unique (notification_id, attempt_number),
  foreign key (notification_id, organization_id)
    references public.notifications(id, organization_id) on delete restrict
);

create index notification_delivery_attempts_timeline_idx
  on public.notification_delivery_attempts(notification_id, attempted_at, id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reservation_id uuid not null,
  patient_id uuid not null references auth.users(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  status public.payment_status not null default 'pending',
  payment_method_kind text not null,
  provider text not null,
  provider_payment_reference text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  correlation_id text,
  authorized_at timestamptz,
  captured_at timestamptz,
  failed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  unique (provider, provider_payment_reference),
  foreign key (reservation_id, organization_id, patient_id)
    references public.reservations(id, organization_id, patient_id)
);

create index payments_patient_idx
  on public.payments(patient_id, created_at desc);
create index payments_reservation_idx
  on public.payments(reservation_id, created_at desc);
create index payments_org_status_idx
  on public.payments(organization_id, status, created_at desc);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  payment_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  status public.refund_status not null default 'pending',
  reason text not null check (char_length(reason) between 3 and 1000),
  provider_refund_reference text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  initiated_by uuid not null references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, payment_id),
  unique (organization_id, idempotency_key),
  foreign key (payment_id, organization_id)
    references public.payments(id, organization_id) on delete restrict
);

create unique index refunds_provider_reference_idx
  on public.refunds(provider_refund_reference)
  where provider_refund_reference is not null;
create index refunds_payment_idx
  on public.refunds(payment_id, created_at desc);
create index refunds_org_status_idx
  on public.refunds(organization_id, status, created_at);

create table public.payment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  payment_id uuid not null,
  refund_id uuid,
  event_type text not null check (char_length(event_type) between 3 and 100),
  provider_event_reference text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  actor_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (
    metadata::text !~* '"(card_number|pan|cvv|cvc|track_data|pin)"[[:space:]]*:'
  ),
  foreign key (payment_id, organization_id)
    references public.payments(id, organization_id) on delete restrict,
  foreign key (refund_id, organization_id, payment_id)
    references public.refunds(id, organization_id, payment_id) on delete restrict
);

create unique index payment_events_provider_event_idx
  on public.payment_events(provider_event_reference)
  where provider_event_reference is not null;
create index payment_events_payment_timeline_idx
  on public.payment_events(payment_id, occurred_at, id);

create table public.adherence_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  patient_id uuid not null references auth.users(id),
  medicine_id uuid not null references public.medicines(id),
  prescription_item_id uuid references public.prescription_items(id),
  timezone text not null,
  local_times time[] not null check (cardinality(local_times) > 0),
  days_of_week smallint[] check (
    days_of_week is null
    or days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  starts_on date not null,
  ends_on date,
  status public.adherence_schedule_status not null default 'active',
  instructions text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (id, organization_id, patient_id),
  unique (organization_id, idempotency_key),
  check (ends_on is null or ends_on >= starts_on)
);

create index adherence_schedules_patient_idx
  on public.adherence_schedules(patient_id, status, starts_on)
  where deleted_at is null;
create index adherence_schedules_due_window_idx
  on public.adherence_schedules(organization_id, starts_on, ends_on)
  where deleted_at is null and status = 'active';

create table public.adherence_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  schedule_id uuid not null,
  patient_id uuid not null references auth.users(id),
  kind public.adherence_event_kind not null,
  scheduled_for timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, idempotency_key),
  foreign key (schedule_id, organization_id, patient_id)
    references public.adherence_schedules(id, organization_id, patient_id)
    on delete restrict
);

create index adherence_events_patient_timeline_idx
  on public.adherence_events(patient_id, scheduled_for desc);
create index adherence_events_schedule_idx
  on public.adherence_events(schedule_id, scheduled_for);
create index adherence_events_org_kind_idx
  on public.adherence_events(organization_id, kind, scheduled_for);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  event_name text not null check (event_name ~ '^[A-Za-z][A-Za-z0-9_.-]{2,99}$'),
  event_version integer not null default 1 check (event_version > 0),
  dimensions jsonb not null default '{}'::jsonb,
  aggregate_count bigint not null default 1 check (aggregate_count > 0),
  metric_value numeric,
  metric_unit text,
  source_reference_hash text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (
    not dimensions ?| array[
      'patient_id', 'user_id', 'email', 'phone', 'name', 'address',
      'prescription_id', 'reservation_id', 'mar_id'
    ]
    and dimensions::text !~* '"(patient_id|user_id|email|phone|name|address|prescription_id|reservation_id|mar_id)"[[:space:]]*:'
  )
);

create index analytics_events_rollup_idx
  on public.analytics_events(organization_id, event_name, occurred_at);
create index analytics_events_dimensions_gin_idx
  on public.analytics_events using gin (dimensions jsonb_path_ops);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mar_id uuid,
  prescription_id uuid,
  agent_name text not null check (agent_name in (
    'prescription_reader', 'medicine_matcher', 'inventory_finder',
    'clinical_review_assistant', 'pricing_advisor',
    'reservation_coordinator', 'medication_education_assistant',
    'population_health_analyst'
  )),
  status public.ai_run_status not null default 'queued',
  provider text,
  model text,
  prompt_version text not null,
  input_reference jsonb not null default '{}'::jsonb,
  output jsonb,
  overall_confidence numeric(5, 4) check (overall_confidence between 0 and 1),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  correlation_id text not null,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (mar_id, organization_id)
    references public.medication_access_requests(id, organization_id),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

create index ai_runs_org_status_idx
  on public.ai_runs(organization_id, status, created_at);
create index ai_runs_mar_idx
  on public.ai_runs(mar_id, created_at desc)
  where mar_id is not null;
create index ai_runs_correlation_idx
  on public.ai_runs(correlation_id);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  ai_run_id uuid not null,
  recommendation_type text not null,
  recommendation jsonb not null,
  rationale text not null,
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  requires_human_review boolean not null default true check (requires_human_review),
  review_status public.review_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, ai_run_id),
  foreign key (ai_run_id, organization_id)
    references public.ai_runs(id, organization_id) on delete restrict,
  check (
    (review_status = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (review_status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index ai_recommendations_review_queue_idx
  on public.ai_recommendations(organization_id, review_status, created_at);
create index ai_recommendations_run_idx
  on public.ai_recommendations(ai_run_id, created_at);

create table public.ai_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  ai_run_id uuid not null,
  recommendation_id uuid,
  event_type text not null check (char_length(event_type) between 3 and 100),
  actor_id uuid references auth.users(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (ai_run_id, organization_id)
    references public.ai_runs(id, organization_id) on delete restrict,
  foreign key (recommendation_id, organization_id, ai_run_id)
    references public.ai_recommendations(id, organization_id, ai_run_id)
    on delete restrict
);

create index ai_audit_events_run_timeline_idx
  on public.ai_audit_events(ai_run_id, occurred_at, id);

create or replace function public.prevent_append_only_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger notification_delivery_attempts_append_only
before update or delete on public.notification_delivery_attempts
for each row execute function public.prevent_append_only_event_mutation();
create trigger payment_events_append_only
before update or delete on public.payment_events
for each row execute function public.prevent_append_only_event_mutation();
create trigger adherence_events_append_only
before update or delete on public.adherence_events
for each row execute function public.prevent_append_only_event_mutation();
create trigger analytics_events_append_only
before update or delete on public.analytics_events
for each row execute function public.prevent_append_only_event_mutation();
create trigger ai_audit_events_append_only
before update or delete on public.ai_audit_events
for each row execute function public.prevent_append_only_event_mutation();

create or replace function public.enforce_refund_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  captured_amount bigint;
  committed_refunds bigint;
begin
  select payment.amount_minor
  into captured_amount
  from public.payments payment
  where payment.id = new.payment_id
    and payment.organization_id = new.organization_id
    and payment.status in ('captured', 'partially_refunded', 'refunded')
  for update;

  if captured_amount is null then
    raise exception 'Refund requires a captured payment';
  end if;

  select coalesce(sum(refund.amount_minor), 0)
  into committed_refunds
  from public.refunds refund
  where refund.payment_id = new.payment_id
    and refund.status in ('pending', 'succeeded')
    and (tg_op = 'INSERT' or refund.id <> new.id);

  if new.status in ('pending', 'succeeded') then
    committed_refunds := committed_refunds + new.amount_minor;
  end if;

  if committed_refunds > captured_amount then
    raise exception 'Refund total exceeds captured payment amount';
  end if;

  return new;
end;
$$;

create trigger refunds_total_guard
before insert or update on public.refunds
for each row execute function public.enforce_refund_total();

create or replace function public.validate_adherence_prescription_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.prescription_item_id is not null
     and not exists (
       select 1
       from public.prescription_items item
       join public.prescriptions prescription
         on prescription.id = item.prescription_id
       where item.id = new.prescription_item_id
         and prescription.organization_id = new.organization_id
         and prescription.patient_id = new.patient_id
         and prescription.deleted_at is null
     ) then
    raise exception 'Prescription item does not belong to schedule tenant and patient';
  end if;
  return new;
end;
$$;

create trigger adherence_schedules_prescription_guard
before insert or update of prescription_item_id, organization_id, patient_id
on public.adherence_schedules
for each row execute function public.validate_adherence_prescription_item();

create or replace function public.prevent_final_ai_review_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AI recommendations cannot be deleted';
  end if;
  if old.review_status in (
    'approved'::public.review_status, 'rejected'::public.review_status
  ) then
    raise exception 'A finalized AI recommendation is immutable';
  end if;
  if new.review_status <> old.review_status
     and new.review_status <> 'pending'::public.review_status
     and (auth.uid() is null or new.reviewed_by <> auth.uid()) then
    raise exception 'AI review decisions require the authenticated human reviewer';
  end if;
  return new;
end;
$$;

create trigger ai_recommendations_final_guard
before update or delete on public.ai_recommendations
for each row execute function public.prevent_final_ai_review_mutation();

create or replace function public.audit_ai_recommendation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ai_audit_events (
      organization_id, ai_run_id, recommendation_id, event_type, actor_id,
      idempotency_key, metadata
    ) values (
      new.organization_id, new.ai_run_id, new.id, 'AI.RecommendationCreated',
      auth.uid(), 'ai-recommendation-created:' || new.id::text,
      jsonb_build_object('confidence', new.confidence)
    );
  elsif new.review_status <> old.review_status then
    insert into public.ai_audit_events (
      organization_id, ai_run_id, recommendation_id, event_type, actor_id,
      idempotency_key, metadata
    ) values (
      new.organization_id, new.ai_run_id, new.id, 'AI.RecommendationReviewed',
      auth.uid(),
      'ai-recommendation-reviewed:' || new.id::text || ':' || new.review_status::text,
      jsonb_build_object('review_status', new.review_status)
    );
  end if;
  return new;
end;
$$;

create trigger ai_recommendations_audit
after insert or update on public.ai_recommendations
for each row execute function public.audit_ai_recommendation();

create trigger notifications_set_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();
create trigger notification_outbox_set_updated_at
before update on public.notification_outbox
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();
create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();
create trigger adherence_schedules_set_updated_at
before update on public.adherence_schedules
for each row execute function public.set_updated_at();
create trigger ai_runs_set_updated_at
before update on public.ai_runs
for each row execute function public.set_updated_at();
create trigger ai_recommendations_set_updated_at
before update on public.ai_recommendations
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_delivery_attempts enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payment_events enable row level security;
alter table public.adherence_schedules enable row level security;
alter table public.adherence_events enable row level security;
alter table public.analytics_events enable row level security;
alter table public.ai_runs enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.ai_audit_events enable row level security;

create policy notifications_read
  on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
-- Outbox and delivery-attempt writes are worker-only through the service role.

create policy payments_read
  on public.payments for select to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin', 'pharmacy_owner',
            'pharmacy_staff']::public.member_role[]
    )
  );
create policy payments_create
  on public.payments for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_organization_member(organization_id)
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id,
        array['pharmacy_owner', 'pharmacy_staff']::public.member_role[]
      )
    )
  );

create policy refunds_read
  on public.refunds for select to authenticated
  using (exists (
    select 1 from public.payments payment
    where payment.id = payment_id
      and (
        payment.patient_id = auth.uid()
        or public.has_organization_role(
          payment.organization_id,
          array['platform_admin', 'tenant_admin', 'pharmacy_owner',
                'pharmacy_staff']::public.member_role[]
        )
      )
  ));
create policy refunds_create
  on public.refunds for insert to authenticated
  with check (
    initiated_by = auth.uid()
    and public.has_organization_role(
      organization_id,
      array['pharmacy_owner', 'pharmacy_staff']::public.member_role[]
    )
  );

create policy payment_events_read
  on public.payment_events for select to authenticated
  using (exists (
    select 1 from public.payments payment
    where payment.id = payment_id
      and (
        payment.patient_id = auth.uid()
        or public.has_organization_role(
          payment.organization_id,
          array['platform_admin', 'tenant_admin', 'pharmacy_owner',
                'pharmacy_staff']::public.member_role[]
        )
      )
  ));
-- Payment-event writes and provider status transitions are worker-only.

create policy adherence_schedules_read
  on public.adherence_schedules for select to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
  );
create policy adherence_schedules_create
  on public.adherence_schedules for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.is_organization_member(organization_id)
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id, array['pharmacist']::public.member_role[]
      )
    )
  );
create policy adherence_schedules_update
  on public.adherence_schedules for update to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
  )
  with check (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
  );

create policy adherence_events_read
  on public.adherence_events for select to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
  );
create policy adherence_events_create
  on public.adherence_events for insert to authenticated
  with check (
    recorded_by = auth.uid()
    and public.is_organization_member(organization_id)
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id, array['pharmacist']::public.member_role[]
      )
    )
  );

create policy analytics_events_read
  on public.analytics_events for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner']::public.member_role[]
  ));
-- Analytics ingestion is worker-only; direct identifiers are rejected by CHECK.

create policy ai_runs_read
  on public.ai_runs for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
    or (
      agent_name = 'population_health_analyst'
      and public.has_organization_role(
        organization_id,
        array['platform_admin', 'tenant_admin']::public.member_role[]
      )
    )
  );
create policy ai_recommendations_read
  on public.ai_recommendations for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
    or exists (
      select 1 from public.ai_runs run
      where run.id = ai_run_id
        and run.agent_name = 'population_health_analyst'
        and public.has_organization_role(
          run.organization_id,
          array['platform_admin', 'tenant_admin']::public.member_role[]
        )
    )
  );
create policy ai_recommendations_pharmacist_review
  on public.ai_recommendations for update to authenticated
  using (public.has_organization_role(
    organization_id, array['pharmacist']::public.member_role[]
  ))
  with check (
    public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
    and review_status <> 'pending'
    and reviewed_by = auth.uid()
    and reviewed_at is not null
  );
create policy ai_audit_events_read
  on public.ai_audit_events for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['pharmacist']::public.member_role[]
    )
    or exists (
      select 1 from public.ai_runs run
      where run.id = ai_run_id
        and run.agent_name = 'population_health_analyst'
        and public.has_organization_role(
          run.organization_id,
          array['platform_admin', 'tenant_admin']::public.member_role[]
        )
    )
  );
-- AI run/recommendation creation and audit-event insertion are worker-only.

comment on table public.notifications is
  'Notification metadata may contain PII/PHI. Prefer opaque template variables and never embed secrets or full prescription content.';
comment on table public.notification_outbox is
  'Operational transactional outbox. Payload content remains in the RLS-protected notification row.';
comment on table public.notification_delivery_attempts is
  'Append-only provider delivery evidence. Error detail must be scrubbed of message content and credentials.';
comment on table public.payments is
  'Financial record containing provider references only. Raw card numbers, CVV, bank credentials, and magnetic-stripe data are prohibited.';
comment on column public.payments.provider_payment_reference is
  'Opaque payment-provider reference; it must not contain raw payment credentials.';
comment on table public.refunds is
  'Refund workflow bounded by the captured payment amount through a locking database trigger.';
comment on table public.payment_events is
  'Append-only financial audit. Metadata must not contain raw card or bank credentials.';
comment on table public.adherence_schedules is
  'Contains PHI: patient medicine schedule and instructions.';
comment on table public.adherence_events is
  'Append-only PHI: patient adherence observations and self-reports.';
comment on table public.analytics_events is
  'Append-only aggregate-ready events. Direct identifiers are absent from the schema and blocked in top-level dimensions.';
comment on column public.analytics_events.source_reference_hash is
  'Optional one-way hash for deduplication; never store the source identifier itself.';
comment on table public.ai_runs is
  'Contains auditable AI inputs/outputs that may be PHI. AI runs cannot transition MAR state or make final clinical decisions.';
comment on table public.ai_recommendations is
  'AI decision support only. Every recommendation requires human review; reviewed recommendations are immutable.';
comment on table public.ai_audit_events is
  'Append-only AI lifecycle and human-review audit trail.';
