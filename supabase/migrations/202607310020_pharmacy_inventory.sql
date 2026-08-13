-- RC2 MVP: canonical pharmacy inventory management.
--
-- Extends the existing inventory_batches and inventory_locks ownership model.
-- Medicine definitions remain owned exclusively by the canonical catalogue.

create type public.inventory_transaction_kind as enum (
  'receive', 'dispense', 'reserve', 'release', 'adjustment', 'expiry', 'return'
);

alter table public.inventory_batches
  add column supplier_name text,
  add column received_on date,
  add column unit_price_minor bigint,
  add column unit_price_currency_code text,
  add column low_stock_threshold integer not null default 5,
  add column inventory_version integer not null default 1;

update public.inventory_batches
set received_on = created_at::date;

alter table public.inventory_batches
  alter column received_on set default current_date,
  alter column received_on set not null,
  add constraint inventory_batches_supplier_length check (
    supplier_name is null
    or char_length(btrim(supplier_name)) between 1 and 240
  ),
  add constraint inventory_batches_unit_price_nonnegative check (
    unit_price_minor is null or unit_price_minor >= 0
  ),
  add constraint inventory_batches_price_currency_pair check (
    (unit_price_minor is null) = (unit_price_currency_code is null)
  ),
  add constraint inventory_batches_unit_price_currency_format check (
    unit_price_currency_code is null
    or unit_price_currency_code ~ '^[A-Z]{3}$'
  ),
  add constraint inventory_batches_low_stock_nonnegative check (
    low_stock_threshold between 0 and 1000000
  ),
  add constraint inventory_batches_version_positive check (
    inventory_version > 0
  );

alter table public.inventory_locks
  add column correlation_id text,
  add column request_id text;

create or replace function public.guard_inventory_batch_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id
     or new.pharmacy_location_id <> old.pharmacy_location_id
     or new.batch_number <> old.batch_number
     or (
       new.medicine_id <> old.medicine_id
       and coalesce(
         current_setting('medlink.catalog_merge', true),
         'off'
       ) <> 'on'
     )
  then
    raise exception 'inventory batch ownership fields are immutable'
      using errcode = '22023';
  end if;
  new.inventory_version := old.inventory_version + 1;
  return new;
end;
$$;

create trigger inventory_batches_identity_and_version_guard
before update on public.inventory_batches
for each row execute function public.guard_inventory_batch_update();

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  pharmacy_location_id uuid not null,
  inventory_batch_id uuid not null,
  medicine_id uuid not null references public.medicines(id),
  transaction_kind public.inventory_transaction_kind not null,
  quantity_delta integer not null,
  reserved_delta integer not null,
  quantity_on_hand_before integer not null check (quantity_on_hand_before >= 0),
  quantity_on_hand_after integer not null check (quantity_on_hand_after >= 0),
  quantity_reserved_before integer not null check (
    quantity_reserved_before >= 0
  ),
  quantity_reserved_after integer not null check (
    quantity_reserved_after >= 0
  ),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  actor_id uuid references auth.users(id),
  idempotency_key text not null check (
    char_length(btrim(idempotency_key)) between 1 and 240
  ),
  correlation_id text not null check (btrim(correlation_id) <> ''),
  request_id text not null check (btrim(request_id) <> ''),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (inventory_batch_id, organization_id)
    references public.inventory_batches(id, organization_id),
  foreign key (pharmacy_location_id, organization_id)
    references public.pharmacy_locations(id, organization_id),
  check (quantity_reserved_after <= quantity_on_hand_after),
  check (
    metadata::text !~*
      '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  )
);

create index inventory_transactions_batch_timeline_idx
  on public.inventory_transactions(inventory_batch_id, occurred_at desc, id);
create index inventory_transactions_org_timeline_idx
  on public.inventory_transactions(organization_id, occurred_at desc);

create or replace function public.prevent_inventory_transaction_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'inventory transactions are append-only';
end;
$$;

create trigger inventory_transactions_append_only
before update or delete on public.inventory_transactions
for each row execute function public.prevent_inventory_transaction_mutation();

alter table public.inventory_transactions enable row level security;

create policy inventory_transactions_operations_read
  on public.inventory_transactions for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array[
      'platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
      'pharmacy_staff', 'inventory_manager'
    ]::public.member_role[]
  ));

revoke insert, update, delete on public.inventory_batches from authenticated;
revoke insert, update, delete on public.inventory_locks from authenticated;
revoke insert, update, delete on public.inventory_transactions
  from authenticated;
grant select on public.inventory_transactions to authenticated;

create or replace function public.inventory_availability_state(
  target_status public.inventory_batch_status,
  target_expires_on date,
  target_available_quantity integer,
  target_reserved_quantity integer,
  target_low_stock_threshold integer,
  target_pharmacy_active boolean
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when not target_pharmacy_active
      or target_status in ('quarantined', 'recalled') then 'inactive'
    when target_status = 'expired' or target_expires_on < current_date
      then 'expired'
    when target_available_quantity = 0 and target_reserved_quantity > 0
      then 'reserved'
    when target_available_quantity = 0 or target_status = 'depleted'
      then 'out_of_stock'
    when target_available_quantity <= target_low_stock_threshold
      then 'low_stock'
    else 'in_stock'
  end;
$$;

revoke all on function public.inventory_availability_state(
  public.inventory_batch_status, date, integer, integer, integer, boolean
) from public;
grant execute on function public.inventory_availability_state(
  public.inventory_batch_status, date, integer, integer, integer, boolean
) to authenticated, service_role;

create or replace function public._record_inventory_transaction(
  target_organization_id uuid,
  target_inventory_id uuid,
  target_kind public.inventory_transaction_kind,
  target_quantity_delta integer,
  target_reserved_delta integer,
  target_on_hand_before integer,
  target_on_hand_after integer,
  target_reserved_before integer,
  target_reserved_after integer,
  target_reason text,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text,
  target_content_hash text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row record;
  created_transaction_id uuid;
  event_type text;
begin
  select batch.* into strict batch_row
  from public.inventory_batches batch
  where batch.id = target_inventory_id
    and batch.organization_id = target_organization_id;

  insert into public.inventory_transactions (
    organization_id, pharmacy_location_id, inventory_batch_id, medicine_id,
    transaction_kind, quantity_delta, reserved_delta,
    quantity_on_hand_before, quantity_on_hand_after,
    quantity_reserved_before, quantity_reserved_after, reason, actor_id,
    idempotency_key, correlation_id, request_id, content_sha256, metadata
  ) values (
    target_organization_id,
    batch_row.pharmacy_location_id,
    target_inventory_id,
    batch_row.medicine_id,
    target_kind,
    target_quantity_delta,
    target_reserved_delta,
    target_on_hand_before,
    target_on_hand_after,
    target_reserved_before,
    target_reserved_after,
    btrim(target_reason),
    auth.uid(),
    target_idempotency_key || ':transaction',
    target_correlation_id,
    target_request_id,
    target_content_hash,
    coalesce(target_metadata, '{}'::jsonb)
  )
  returning id into created_transaction_id;

  event_type := case target_kind
    when 'receive' then 'inventory.received.v1'
    when 'dispense' then 'inventory.dispensed.v1'
    when 'reserve' then 'inventory.reserved.v1'
    when 'release' then 'inventory.released.v1'
    when 'adjustment' then 'inventory.adjusted.v1'
    when 'expiry' then 'inventory.expired.v1'
    when 'return' then 'inventory.returned.v1'
  end;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    event_type,
    'inventory_batch',
    target_inventory_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'inventoryId', target_inventory_id,
      'transactionId', created_transaction_id,
      'pharmacyLocationId', batch_row.pharmacy_location_id,
      'medicineId', batch_row.medicine_id,
      'kind', target_kind,
      'quantityDelta', target_quantity_delta,
      'reservedDelta', target_reserved_delta,
      'version', batch_row.inventory_version,
      'contentSha256', target_content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':event'
  );

  if target_on_hand_after - target_reserved_after > 0
     and target_on_hand_after - target_reserved_after
       <= batch_row.low_stock_threshold
     and target_on_hand_before - target_reserved_before
       > batch_row.low_stock_threshold
  then
    insert into public.runtime_outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id, payload,
      correlation_id, request_id, idempotency_key
    ) values (
      target_organization_id,
      'inventory.low.v1',
      'inventory_batch',
      target_inventory_id::text,
      jsonb_build_object(
        'tenantId', target_organization_id,
        'inventoryId', target_inventory_id,
        'pharmacyLocationId', batch_row.pharmacy_location_id,
        'medicineId', batch_row.medicine_id,
        'availableQuantity',
          target_on_hand_after - target_reserved_after,
        'lowStockThreshold', batch_row.low_stock_threshold,
        'version', batch_row.inventory_version
      ),
      target_correlation_id,
      target_request_id,
      target_idempotency_key || ':low-stock-event'
    );
  end if;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'inventory.stock',
    case when auth.uid() is null then 'system' else 'user' end,
    coalesce(auth.uid()::text, 'inventory-worker'),
    'inventory_batch',
    target_inventory_id::text,
    'inventory.' || target_kind::text,
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit',
    'web',
    jsonb_build_object(
      'transactionId', created_transaction_id,
      'quantityDelta', target_quantity_delta,
      'reservedDelta', target_reserved_delta,
      'version', batch_row.inventory_version,
      'contentSha256', target_content_hash
    )
  );

  return created_transaction_id;
end;
$$;

revoke all on function public._record_inventory_transaction(
  uuid, uuid, public.inventory_transaction_kind, integer, integer,
  integer, integer, integer, integer, text, text, text, text, text, jsonb
) from public, authenticated, service_role;

create or replace function public.create_inventory_batch(
  target_organization_id uuid,
  target_document jsonb,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_batch record;
  prior_transaction record;
  content_hash text;
  received_date date;
  expiry_date date;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_document is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or not public.has_organization_role(
       target_organization_id,
       array[
         'platform_admin', 'tenant_admin', 'pharmacy_owner',
         'pharmacy_staff', 'inventory_manager'
       ]::public.member_role[]
     )
     or jsonb_typeof(target_document) is distinct from 'object'
     or not (
       target_document ?& array[
         'pharmacyLocationId', 'medicineId', 'batchNumber', 'expiresOn',
         'quantity', 'unit', 'lowStockThreshold'
       ]
     )
     or (
       target_document
       - array[
           'pharmacyLocationId', 'medicineId', 'batchNumber', 'expiresOn',
           'supplier', 'receivedOn', 'quantity', 'unit', 'unitPriceMinor',
           'currencyCode', 'lowStockThreshold'
         ]
     ) <> '{}'::jsonb
     or jsonb_typeof(target_document->'pharmacyLocationId')
       is distinct from 'string'
     or jsonb_typeof(target_document->'medicineId')
       is distinct from 'string'
     or jsonb_typeof(target_document->'batchNumber')
       is distinct from 'string'
     or jsonb_typeof(target_document->'expiresOn')
       is distinct from 'string'
     or jsonb_typeof(target_document->'quantity')
       is distinct from 'number'
     or jsonb_typeof(target_document->'unit') is distinct from 'string'
     or jsonb_typeof(target_document->'lowStockThreshold')
       is distinct from 'number'
     or (target_document->>'pharmacyLocationId') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
     or (target_document->>'medicineId') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
     or char_length(btrim(target_document->>'batchNumber'))
       not between 1 and 120
     or (target_document->>'expiresOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (target_document->>'quantity') !~ '^[1-9][0-9]*$'
     or (target_document->>'quantity')::numeric > 2147483647
     or char_length(btrim(target_document->>'unit')) not between 1 and 40
     or (target_document->>'lowStockThreshold') !~ '^[0-9]+$'
     or (target_document->>'lowStockThreshold')::numeric > 1000000
     or (
       target_document ? 'supplier'
       and target_document->'supplier' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'supplier') is distinct from 'string'
         or char_length(btrim(target_document->>'supplier'))
           not between 1 and 240
       )
     )
     or (
       target_document ? 'receivedOn'
       and target_document->'receivedOn' <> 'null'::jsonb
       and (target_document->>'receivedOn') !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     )
     or (
       target_document ? 'unitPriceMinor'
       and target_document->'unitPriceMinor' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'unitPriceMinor')
           is distinct from 'number'
         or (target_document->>'unitPriceMinor')::numeric < 0
         or (target_document->>'unitPriceMinor')::numeric > 9223372036854775807
       )
     )
     or (
       target_document ? 'currencyCode'
       and target_document->'currencyCode' <> 'null'::jsonb
       and (target_document->>'currencyCode') !~ '^[A-Z]{3}$'
     )
     or (
       (target_document->>'unitPriceMinor' is null)
       <> (target_document->>'currencyCode' is null)
     )
     or char_length(btrim(target_idempotency_key)) not between 1 and 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid inventory batch document'
      using errcode = '22023';
  end if;

  begin
    expiry_date := (target_document->>'expiresOn')::date;
    received_date := coalesce(
      (target_document->>'receivedOn')::date,
      current_date
    );
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'invalid inventory batch date'
      using errcode = '22023';
  end;

  if expiry_date < current_date or received_date > current_date then
    raise exception 'inventory batch dates are invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.pharmacy_locations location
    where location.id = (target_document->>'pharmacyLocationId')::uuid
      and location.organization_id = target_organization_id
      and location.is_active
      and location.deleted_at is null
  ) then
    raise exception 'active pharmacy location was not found'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.medicines medicine
    where medicine.id = (target_document->>'medicineId')::uuid
      and medicine.status = 'active'
      and medicine.deleted_at is null
  ) then
    raise exception 'active canonical medicine was not found'
      using errcode = '23503';
  end if;

  content_hash := encode(
    public.digest(convert_to(target_document::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || target_idempotency_key,
      0
    )
  );

  select transaction.* into prior_transaction
  from public.inventory_transactions transaction
  where transaction.organization_id = target_organization_id
    and transaction.idempotency_key =
      target_idempotency_key || ':transaction';

  if found then
    if prior_transaction.content_sha256 <> content_hash then
      raise exception 'inventory receipt idempotency conflict'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'inventoryId', prior_transaction.inventory_batch_id
    );
  end if;

  insert into public.inventory_batches (
    organization_id, pharmacy_location_id, medicine_id, batch_number,
    expires_on, supplier_name, received_on, quantity_on_hand,
    quantity_reserved, unit, unit_price_minor, unit_price_currency_code,
    low_stock_threshold, status, created_by
  ) values (
    target_organization_id,
    (target_document->>'pharmacyLocationId')::uuid,
    (target_document->>'medicineId')::uuid,
    btrim(target_document->>'batchNumber'),
    expiry_date,
    nullif(btrim(target_document->>'supplier'), ''),
    received_date,
    (target_document->>'quantity')::integer,
    0,
    btrim(target_document->>'unit'),
    (target_document->>'unitPriceMinor')::bigint,
    target_document->>'currencyCode',
    (target_document->>'lowStockThreshold')::integer,
    'available',
    auth.uid()
  )
  returning * into created_batch;

  perform public._record_inventory_transaction(
    target_organization_id,
    created_batch.id,
    'receive',
    created_batch.quantity_on_hand,
    0,
    0,
    created_batch.quantity_on_hand,
    0,
    0,
    'Initial batch receipt',
    target_idempotency_key,
    target_correlation_id,
    target_request_id,
    content_hash,
    jsonb_build_object(
      'batchNumber', created_batch.batch_number,
      'receivedOn', created_batch.received_on
    )
  );

  return jsonb_build_object(
    'inventoryId', created_batch.id,
    'version', created_batch.inventory_version,
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.create_inventory_batch(
  uuid, jsonb, text, text, text
) from public;
grant execute on function public.create_inventory_batch(
  uuid, jsonb, text, text, text
) to authenticated;

create or replace function public.update_inventory_batch(
  target_organization_id uuid,
  target_inventory_id uuid,
  target_expected_version integer,
  target_document jsonb,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row record;
  resulting_version integer;
  prior_event record;
  content_hash text;
  expiry_date date;
  received_date date;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_inventory_id is null
     or target_expected_version is null
     or target_expected_version < 1
     or target_document is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or not public.has_organization_role(
       target_organization_id,
       array[
         'platform_admin', 'tenant_admin', 'pharmacy_owner',
         'pharmacy_staff', 'inventory_manager'
       ]::public.member_role[]
     )
     or jsonb_typeof(target_document) is distinct from 'object'
     or not (
       target_document ?& array[
         'expiresOn', 'receivedOn', 'unit', 'lowStockThreshold', 'status'
       ]
     )
     or (
       target_document
       - array[
           'expiresOn', 'supplier', 'receivedOn', 'unit', 'unitPriceMinor',
           'currencyCode', 'lowStockThreshold', 'status'
         ]
     ) <> '{}'::jsonb
     or jsonb_typeof(target_document->'expiresOn')
       is distinct from 'string'
     or jsonb_typeof(target_document->'receivedOn')
       is distinct from 'string'
     or jsonb_typeof(target_document->'unit') is distinct from 'string'
     or jsonb_typeof(target_document->'lowStockThreshold')
       is distinct from 'number'
     or jsonb_typeof(target_document->'status') is distinct from 'string'
     or (target_document->>'expiresOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (target_document->>'receivedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or char_length(btrim(target_document->>'unit')) not between 1 and 40
     or (target_document->>'lowStockThreshold') !~ '^[0-9]+$'
     or (target_document->>'lowStockThreshold')::numeric > 1000000
     or target_document->>'status' not in (
       'available', 'quarantined', 'recalled', 'depleted', 'expired'
     )
     or (
       target_document ? 'supplier'
       and target_document->'supplier' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'supplier') is distinct from 'string'
         or char_length(btrim(target_document->>'supplier'))
           not between 1 and 240
       )
     )
     or (
       target_document ? 'unitPriceMinor'
       and target_document->'unitPriceMinor' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'unitPriceMinor')
           is distinct from 'number'
         or (target_document->>'unitPriceMinor')::numeric < 0
         or (target_document->>'unitPriceMinor')::numeric > 9223372036854775807
       )
     )
     or (
       target_document ? 'currencyCode'
       and target_document->'currencyCode' <> 'null'::jsonb
       and (target_document->>'currencyCode') !~ '^[A-Z]{3}$'
     )
     or (
       (target_document->>'unitPriceMinor' is null)
       <> (target_document->>'currencyCode' is null)
     )
     or char_length(btrim(target_idempotency_key)) not between 1 and 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid inventory batch update'
      using errcode = '22023';
  end if;

  begin
    expiry_date := (target_document->>'expiresOn')::date;
    received_date := (target_document->>'receivedOn')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'invalid inventory batch date'
      using errcode = '22023';
  end;

  if received_date > current_date
     or (
       expiry_date < current_date
       and target_document->>'status' <> 'expired'
     )
  then
    raise exception 'inventory batch dates conflict with its status'
      using errcode = '22023';
  end if;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'inventoryId', target_inventory_id,
          'expectedVersion', target_expected_version,
          'document', target_document
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select event.payload into prior_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':updated';

  if found then
    if prior_event.payload->>'contentSha256' <> content_hash then
      raise exception 'inventory update idempotency conflict'
        using errcode = '23505';
    end if;
    return prior_event.payload;
  end if;

  select batch.* into strict batch_row
  from public.inventory_batches batch
  where batch.id = target_inventory_id
    and batch.organization_id = target_organization_id
    and batch.deleted_at is null
  for update;

  if batch_row.inventory_version <> target_expected_version then
    raise exception 'inventory batch version conflict'
      using errcode = '40001';
  end if;

  if batch_row.status in ('recalled', 'expired')
     and target_document->>'status' <> batch_row.status::text
  then
    raise exception 'final inventory status cannot be reactivated'
      using errcode = '22023';
  end if;

  if target_document->>'status' = 'depleted'
     and batch_row.quantity_on_hand > 0
  then
    raise exception 'non-empty inventory cannot be marked depleted'
      using errcode = '22023';
  end if;

  update public.inventory_batches
  set expires_on = expiry_date,
      supplier_name = nullif(btrim(target_document->>'supplier'), ''),
      received_on = received_date,
      unit = btrim(target_document->>'unit'),
      unit_price_minor = (target_document->>'unitPriceMinor')::bigint,
      unit_price_currency_code = target_document->>'currencyCode',
      low_stock_threshold =
        (target_document->>'lowStockThreshold')::integer,
      status =
        (target_document->>'status')::public.inventory_batch_status
  where id = target_inventory_id
    and organization_id = target_organization_id
  returning inventory_version into resulting_version;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    'inventory.batch-updated.v1',
    'inventory_batch',
    target_inventory_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'inventoryId', target_inventory_id,
      'version', resulting_version,
      'status', target_document->>'status',
      'contentSha256', content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':updated'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'inventory.batch',
    'user',
    auth.uid()::text,
    'inventory_batch',
    target_inventory_id::text,
    case
      when batch_row.unit_price_minor is distinct from
             (target_document->>'unitPriceMinor')::bigint
        or batch_row.unit_price_currency_code is distinct from
             target_document->>'currencyCode'
        then 'inventory.price-update'
      else 'inventory.update'
    end,
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-updated',
    'web',
    jsonb_build_object(
      'version', resulting_version,
      'status', target_document->>'status',
      'contentSha256', content_hash
    )
  );

  return jsonb_build_object(
    'inventoryId', target_inventory_id,
    'version', resulting_version,
    'status', target_document->>'status',
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.update_inventory_batch(
  uuid, uuid, integer, jsonb, text, text, text
) from public;
grant execute on function public.update_inventory_batch(
  uuid, uuid, integer, jsonb, text, text, text
) to authenticated;

create or replace function public.change_inventory_stock(
  target_organization_id uuid,
  target_inventory_id uuid,
  target_expected_version integer,
  target_kind public.inventory_transaction_kind,
  target_quantity integer,
  target_reason text,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row record;
  prior_transaction record;
  quantity_delta integer;
  resulting_quantity integer;
  resulting_status public.inventory_batch_status;
  resulting_version integer;
  content_hash text;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_inventory_id is null
     or target_expected_version is null
     or target_expected_version < 1
     or target_kind is null
     or target_kind not in ('receive', 'dispense', 'adjustment', 'return')
     or target_quantity is null
     or target_quantity = 0
     or (
       target_kind in ('receive', 'dispense', 'return')
       and target_quantity < 1
     )
     or target_reason is null
     or char_length(btrim(target_reason)) not between 3 and 1000
     or target_idempotency_key is null
     or char_length(btrim(target_idempotency_key)) not between 1 and 200
     or target_correlation_id is null
     or btrim(target_correlation_id) = ''
     or target_request_id is null
     or btrim(target_request_id) = ''
     or not public.has_organization_role(
       target_organization_id,
       array[
         'platform_admin', 'tenant_admin', 'pharmacy_owner',
         'pharmacy_staff', 'inventory_manager'
       ]::public.member_role[]
     )
  then
    raise exception 'invalid inventory stock change'
      using errcode = '22023';
  end if;

  quantity_delta := case target_kind
    when 'receive' then target_quantity
    when 'return' then target_quantity
    when 'dispense' then -target_quantity
    else target_quantity
  end;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'inventoryId', target_inventory_id,
          'expectedVersion', target_expected_version,
          'kind', target_kind,
          'quantity', target_quantity,
          'reason', btrim(target_reason)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || target_idempotency_key,
      0
    )
  );

  select transaction.* into prior_transaction
  from public.inventory_transactions transaction
  where transaction.organization_id = target_organization_id
    and transaction.idempotency_key =
      target_idempotency_key || ':transaction';

  if found then
    if prior_transaction.content_sha256 <> content_hash then
      raise exception 'inventory change idempotency conflict'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'inventoryId', prior_transaction.inventory_batch_id,
      'contentSha256', content_hash
    );
  end if;

  select batch.* into strict batch_row
  from public.inventory_batches batch
  join public.pharmacy_locations location
    on location.id = batch.pharmacy_location_id
   and location.organization_id = batch.organization_id
  where batch.id = target_inventory_id
    and batch.organization_id = target_organization_id
    and batch.deleted_at is null
    and location.deleted_at is null
  for update of batch;

  if batch_row.inventory_version <> target_expected_version then
    raise exception 'inventory batch version conflict'
      using errcode = '40001';
  end if;

  if batch_row.status in ('recalled', 'expired')
     or batch_row.expires_on < current_date
  then
    raise exception 'final or expired inventory cannot change quantity'
      using errcode = '22023';
  end if;

  if target_kind = 'dispense'
     and (
       batch_row.status <> 'available'
       or batch_row.available_quantity < target_quantity
     )
  then
    raise exception 'insufficient available inventory to dispense'
      using errcode = '22023';
  end if;

  resulting_quantity := batch_row.quantity_on_hand + quantity_delta;
  if resulting_quantity < batch_row.quantity_reserved
     or resulting_quantity < 0
  then
    raise exception 'stock change would consume reserved inventory'
      using errcode = '22023';
  end if;

  resulting_status := case
    when resulting_quantity = 0 then 'depleted'
    when batch_row.status = 'depleted' and quantity_delta > 0 then 'available'
    else batch_row.status
  end;

  update public.inventory_batches
  set quantity_on_hand = resulting_quantity,
      status = resulting_status
  where id = target_inventory_id
    and organization_id = target_organization_id
  returning inventory_version into resulting_version;

  perform public._record_inventory_transaction(
    target_organization_id,
    target_inventory_id,
    target_kind,
    quantity_delta,
    0,
    batch_row.quantity_on_hand,
    resulting_quantity,
    batch_row.quantity_reserved,
    batch_row.quantity_reserved,
    btrim(target_reason),
    target_idempotency_key,
    target_correlation_id,
    target_request_id,
    content_hash,
    jsonb_build_object(
      'version', resulting_version,
      'status', resulting_status
    )
  );

  return jsonb_build_object(
    'inventoryId', target_inventory_id,
    'version', resulting_version,
    'status', resulting_status,
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.change_inventory_stock(
  uuid, uuid, integer, public.inventory_transaction_kind, integer,
  text, text, text, text
) from public;
grant execute on function public.change_inventory_stock(
  uuid, uuid, integer, public.inventory_transaction_kind, integer,
  text, text, text, text
) to authenticated;

create or replace function public.record_inventory_lock_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row record;
  transaction_kind public.inventory_transaction_kind;
  on_hand_before integer;
  reserved_before integer;
  quantity_delta integer := 0;
  reserved_delta integer := 0;
  reason text;
  content_hash text;
  operation_key text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  select batch.* into strict batch_row
  from public.inventory_batches batch
  where batch.id = new.inventory_batch_id
    and batch.organization_id = new.organization_id;

  if tg_op = 'INSERT' then
    transaction_kind := 'reserve';
    on_hand_before := batch_row.quantity_on_hand;
    reserved_before := batch_row.quantity_reserved - new.quantity;
    reserved_delta := new.quantity;
    reason := 'Inventory reserved';
    operation_key := new.idempotency_key || ':reserved';
  elsif old.status = 'active' and new.status = 'consumed' then
    transaction_kind := 'dispense';
    on_hand_before := batch_row.quantity_on_hand + old.quantity;
    reserved_before := batch_row.quantity_reserved + old.quantity;
    quantity_delta := -old.quantity;
    reserved_delta := -old.quantity;
    reason := 'Reserved inventory dispensed';
    operation_key := new.idempotency_key || ':consumed';
  elsif old.status = 'active' and new.status = 'expired' then
    transaction_kind := 'expiry';
    on_hand_before := batch_row.quantity_on_hand;
    reserved_before := batch_row.quantity_reserved + old.quantity;
    reserved_delta := -old.quantity;
    reason := 'Expired inventory hold released';
    operation_key := new.idempotency_key || ':expired';
  elsif old.status = 'active' and new.status = 'released' then
    transaction_kind := 'release';
    on_hand_before := batch_row.quantity_on_hand;
    reserved_before := batch_row.quantity_reserved + old.quantity;
    reserved_delta := -old.quantity;
    reason := 'Inventory hold released';
    operation_key := new.idempotency_key || ':released';
  else
    return new;
  end if;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'lockId', new.id,
          'reservationId', new.reservation_id,
          'inventoryId', new.inventory_batch_id,
          'kind', transaction_kind,
          'quantity', new.quantity,
          'status', new.status
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform public._record_inventory_transaction(
    new.organization_id,
    new.inventory_batch_id,
    transaction_kind,
    quantity_delta,
    reserved_delta,
    on_hand_before,
    batch_row.quantity_on_hand,
    reserved_before,
    batch_row.quantity_reserved,
    reason,
    operation_key,
    coalesce(new.correlation_id, new.idempotency_key),
    coalesce(new.request_id, new.id::text),
    content_hash,
    jsonb_build_object(
      'lockId', new.id,
      'reservationId', new.reservation_id,
      'lockStatus', new.status
    )
  );

  return new;
end;
$$;

create trigger inventory_locks_transaction_record
after insert or update on public.inventory_locks
for each row execute function public.record_inventory_lock_transaction();

create or replace function public.search_inventory_availability(
  target_organization_id uuid,
  target_medicine_id uuid default null,
  target_pharmacy_location_id uuid default null,
  target_quantity integer default 1
)
returns table (
  inventory_id uuid,
  pharmacy_location_id uuid,
  pharmacy_name text,
  medicine_id uuid,
  brand_name text,
  generic_name text,
  strength text,
  batch_number text,
  expires_on date,
  available_quantity integer,
  unit text,
  unit_price_minor bigint,
  currency_code text,
  availability_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or target_organization_id is null
     or not public.is_organization_member(target_organization_id)
     or target_quantity is null
     or target_quantity < 1
     or target_quantity > 1000000
  then
    raise exception 'invalid inventory availability context'
      using errcode = '22023';
  end if;

  return query
  select
    batch.id,
    location.id,
    location.name,
    medicine.id,
    medicine.brand_name,
    medicine.generic_name,
    medicine.strength_display,
    batch.batch_number,
    batch.expires_on,
    batch.available_quantity,
    batch.unit,
    batch.unit_price_minor,
    batch.unit_price_currency_code,
    public.inventory_availability_state(
      batch.status,
      batch.expires_on,
      batch.available_quantity,
      batch.quantity_reserved,
      batch.low_stock_threshold,
      location.is_active
    )
  from public.inventory_batches batch
  join public.pharmacy_locations location
    on location.id = batch.pharmacy_location_id
   and location.organization_id = batch.organization_id
  join public.medicines medicine on medicine.id = batch.medicine_id
  where batch.organization_id = target_organization_id
    and (
      target_medicine_id is null
      or batch.medicine_id = target_medicine_id
    )
    and (
      target_pharmacy_location_id is null
      or batch.pharmacy_location_id = target_pharmacy_location_id
    )
    and batch.status = 'available'
    and batch.deleted_at is null
    and batch.expires_on >= current_date
    and batch.available_quantity >= target_quantity
    and location.is_active
    and location.deleted_at is null
    and medicine.status = 'active'
    and medicine.deleted_at is null
  order by
    medicine.id,
    batch.expires_on,
    batch.available_quantity desc,
    batch.id;
end;
$$;

revoke all on function public.search_inventory_availability(
  uuid, uuid, uuid, integer
) from public;
grant execute on function public.search_inventory_availability(
  uuid, uuid, uuid, integer
) to authenticated;

create or replace function public.release_inventory_hold(
  target_organization_id uuid,
  target_lock_id uuid,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lock_row record;
  reservation_row record;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_lock_id is null
     or target_idempotency_key is null
     or char_length(btrim(target_idempotency_key)) not between 1 and 200
     or target_correlation_id is null
     or btrim(target_correlation_id) = ''
     or target_request_id is null
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid inventory release context'
      using errcode = '22023';
  end if;

  select lock.* into strict lock_row
  from public.inventory_locks lock
  where lock.id = target_lock_id
    and lock.organization_id = target_organization_id
  for update;

  select reservation.* into strict reservation_row
  from public.reservations reservation
  where reservation.id = lock_row.reservation_id
    and reservation.organization_id = target_organization_id
  for update;

  if reservation_row.patient_id <> auth.uid()
     and not public.has_organization_role(
       target_organization_id,
       array[
         'platform_admin', 'tenant_admin', 'pharmacist',
         'pharmacy_owner', 'pharmacy_staff', 'inventory_manager'
       ]::public.member_role[]
     )
  then
    raise exception 'inventory hold release is not permitted'
      using errcode = '42501';
  end if;

  if lock_row.status in ('released', 'expired') then
    return jsonb_build_object(
      'lockId', lock_row.id,
      'reservationId', lock_row.reservation_id,
      'status', lock_row.status,
      'released', true
    );
  end if;

  if lock_row.status <> 'active' then
    raise exception 'final inventory hold cannot be released'
      using errcode = '22023';
  end if;

  update public.inventory_locks
  set status = 'released',
      released_at = now(),
      correlation_id = target_correlation_id,
      request_id = target_request_id
  where id = target_lock_id;

  update public.reservations
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      updated_at = now()
  where id = reservation_row.id
    and status in ('pending', 'confirmed', 'ready');

  update public.medication_access_requests
  set state = 'cancelled',
      completed_at = coalesce(completed_at, now()),
      transition_idempotency_key = target_idempotency_key || ':mar',
      updated_at = now()
  where id = reservation_row.mar_id
    and organization_id = target_organization_id
    and state = 'reserved';

  return jsonb_build_object(
    'lockId', target_lock_id,
    'reservationId', reservation_row.id,
    'status', 'released',
    'released', true
  );
end;
$$;

revoke all on function public.release_inventory_hold(
  uuid, uuid, text, text, text
) from public;
grant execute on function public.release_inventory_hold(
  uuid, uuid, text, text, text
) to authenticated;

create or replace function public.release_expired_inventory_holds(
  target_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lock_row record;
  batch_row record;
  released_holds integer := 0;
  expired_batches integer := 0;
  operation_key text;
  content_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     or target_limit is null
     or target_limit not between 1 and 1000
  then
    raise exception 'inventory expiry worker is not authorized'
      using errcode = '42501';
  end if;

  for lock_row in
    select
      lock.id,
      lock.organization_id,
      lock.reservation_id,
      reservation.mar_id
    from public.inventory_locks lock
    join public.reservations reservation
      on reservation.id = lock.reservation_id
     and reservation.organization_id = lock.organization_id
    where lock.status = 'active'
      and lock.expires_at <= now()
      and reservation.status in ('pending', 'confirmed', 'ready')
    order by lock.expires_at, lock.id
    limit target_limit
    for update of lock skip locked
  loop
    operation_key := 'inventory-expiry:' || lock_row.id::text;

    update public.inventory_locks
    set status = 'expired',
        released_at = now(),
        correlation_id = operation_key,
        request_id = operation_key
    where id = lock_row.id;

    update public.reservations
    set status = 'expired',
        updated_at = now()
    where id = lock_row.reservation_id
      and status in ('pending', 'confirmed', 'ready');

    update public.medication_access_requests
    set state = 'expired',
        completed_at = coalesce(completed_at, now()),
        transition_idempotency_key = operation_key || ':mar',
        updated_at = now()
    where id = lock_row.mar_id
      and organization_id = lock_row.organization_id
      and state = 'reserved';

    released_holds := released_holds + 1;
  end loop;

  for batch_row in
    select batch.*
    from public.inventory_batches batch
    where batch.expires_on < current_date
      and batch.status in ('available', 'quarantined')
      and batch.deleted_at is null
      and not exists (
        select 1
        from public.inventory_locks lock
        where lock.inventory_batch_id = batch.id
          and lock.organization_id = batch.organization_id
          and lock.status = 'active'
      )
    order by batch.expires_on, batch.id
    limit target_limit
    for update skip locked
  loop
    operation_key :=
      'inventory-batch-expiry:' || batch_row.id::text || ':'
      || current_date::text;
    content_hash := encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'inventoryId', batch_row.id,
            'expiresOn', batch_row.expires_on,
            'status', 'expired'
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    update public.inventory_batches
    set status = 'expired'
    where id = batch_row.id;

    perform public._record_inventory_transaction(
      batch_row.organization_id,
      batch_row.id,
      'expiry',
      0,
      0,
      batch_row.quantity_on_hand,
      batch_row.quantity_on_hand,
      batch_row.quantity_reserved,
      batch_row.quantity_reserved,
      'Inventory batch reached its expiry date',
      operation_key,
      operation_key,
      operation_key,
      content_hash,
      jsonb_build_object('expiresOn', batch_row.expires_on)
    );

    expired_batches := expired_batches + 1;
  end loop;

  return jsonb_build_object(
    'releasedHolds', released_holds,
    'expiredBatches', expired_batches
  );
end;
$$;

revoke all on function public.release_expired_inventory_holds(integer)
  from public;
grant execute on function public.release_expired_inventory_holds(integer)
  to service_role;

comment on table public.inventory_transactions is
  'Immutable stock ledger. Quantity and reservation changes are recorded once with correlation and idempotency evidence.';
comment on function public.search_inventory_availability(
  uuid, uuid, uuid, integer
) is
  'Patient-safe tenant-scoped FEFO availability projection; excludes acquisition cost and inactive or expired stock.';
comment on function public.release_expired_inventory_holds(integer) is
  'Service-role worker command that releases expired holds and retires expired batches without bypassing inventory accounting.';
