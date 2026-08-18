-- Pharmacy Onboarding -> SKU -> Inventory E2E, Phase 1 (foundational data
-- model only). Approved architecture: a pharmacy-local catalog layer plus
-- a durable, auditable mapping layer sits upstream of inventory_batches --
-- inventory_batches.medicine_id continues to reference the canonical
-- medicines table directly and is NOT modified by this migration.
-- search_inventory_availability, reserve_inventory, match_inventory, and
-- every certified discovery/reservation/payment/fulfillment contract are
-- untouched.
--
-- Two tables, not one, matching the approved decision: pharmacy_catalog_items
-- is "what does this pharmacy/location call this item" (pharmacy-local
-- identity, survives remapping); pharmacy_catalog_mappings is "which
-- already-canonical medicine does this local item represent" (a governed,
-- historied assertion). A local SKU never becomes canonical medicine
-- identity by merely existing -- only a pharmacist-confirmed mapping row
-- with is_current=true does that, and even then inventory_batches itself
-- is untouched; a later slice wires inventory creation to require a
-- current mapping (the "inventory publication gate"), deliberately not
-- part of this migration.

create type public.pharmacy_catalog_item_status as enum ('active', 'inactive');

create table public.pharmacy_catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  pharmacy_location_id uuid not null,
  external_sku text not null check (char_length(btrim(external_sku)) between 1 and 120),
  source_product_name text,
  source_description text,
  barcode text,
  gtin text,
  nafdac_registration_number text,
  source_brand text,
  source_generic_name text,
  source_ingredients text,
  source_strength text,
  source_dosage_form text,
  source_pack_size text,
  source_manufacturer text,
  status public.pharmacy_catalog_item_status not null default 'active',
  source_system text not null default 'manual'
    check (source_system in ('manual', 'csv', 'api')),
  source_record_id text,
  source_updated_at timestamptz,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (pharmacy_location_id, external_sku),
  unique (organization_id, idempotency_key),
  foreign key (pharmacy_location_id, organization_id)
    references public.pharmacy_locations(id, organization_id)
);

create index pharmacy_catalog_items_location_idx
  on public.pharmacy_catalog_items(pharmacy_location_id, status)
  where deleted_at is null;

create trigger pharmacy_catalog_items_set_updated_at
before update on public.pharmacy_catalog_items
for each row execute function public.set_updated_at();

alter table public.pharmacy_catalog_items enable row level security;

-- Mirrors inventory_batches_member_read/inventory_batches_manage exactly:
-- the same roles that may operate inventory may operate the catalog layer
-- feeding it. No new persona introduced.
create policy pharmacy_catalog_items_member_read
  on public.pharmacy_catalog_items for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ));

comment on table public.pharmacy_catalog_items is
  'Pharmacy-local catalog identity ("what this pharmacy calls this item"). Never itself canonical medicine identity -- see pharmacy_catalog_mappings.';

create type public.pharmacy_catalog_mapping_status as enum (
  'matched', 'review_required', 'unmatched', 'conflict', 'rejected'
);

create table public.pharmacy_catalog_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  pharmacy_catalog_item_id uuid not null,
  medicine_id uuid not null references public.medicines(id),
  mapping_status public.pharmacy_catalog_mapping_status not null,
  mapping_method text not null
    check (mapping_method in (
      'nafdac_registration', 'barcode', 'manual', 'manufacturer_attributes'
    )),
  confidence numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  is_current boolean not null default false,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text
    check (rejection_reason is null or char_length(btrim(rejection_reason)) >= 3),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (pharmacy_catalog_item_id, organization_id)
    references public.pharmacy_catalog_items(id, organization_id),
  -- Current-mapping contract: at most one row per catalog item may claim
  -- current authority, and only a matched decision may hold it -- proposals
  -- (review_required/unmatched/conflict) and rejections never do.
  check (not is_current or mapping_status = 'matched'),
  check (
    (mapping_status = 'matched') = (verified_by is not null and verified_at is not null)
  ),
  check (
    (mapping_status = 'rejected')
    = (rejected_by is not null and rejected_at is not null and rejection_reason is not null)
  )
);

create unique index pharmacy_catalog_mappings_one_current_idx
  on public.pharmacy_catalog_mappings(pharmacy_catalog_item_id)
  where is_current;

create index pharmacy_catalog_mappings_item_idx
  on public.pharmacy_catalog_mappings(pharmacy_catalog_item_id, created_at desc);
create index pharmacy_catalog_mappings_review_queue_idx
  on public.pharmacy_catalog_mappings(organization_id, mapping_status)
  where mapping_status in ('review_required', 'conflict');

create trigger pharmacy_catalog_mappings_set_updated_at
before update on public.pharmacy_catalog_mappings
for each row execute function public.set_updated_at();

alter table public.pharmacy_catalog_mappings enable row level security;

create policy pharmacy_catalog_mappings_member_read
  on public.pharmacy_catalog_mappings for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ));

comment on table public.pharmacy_catalog_mappings is
  'Governed, historied assertion that a pharmacy_catalog_items row represents a specific already-canonical medicines.id. At most one is_current=true row per item (partial unique index), and only ever a matched one. Superseding a mapping never deletes the prior row -- history/provenance is preserved by construction.';

-- All writes go through these RPCs, matching create_inventory_batch/
-- reserve_inventory's own convention: authenticated table grants for
-- insert/update/delete are revoked, so nothing can bypass the invariants
-- enforced here. RLS policies above are a second, independent gate on top
-- of ordinary table privileges, not a replacement for them -- the SELECT
-- grant itself is still required or every read fails closed with 42501
-- regardless of policy (the exact gap 202608170060 already had to fix once
-- for public.refunds).
revoke insert, update, delete on public.pharmacy_catalog_items from authenticated;
revoke insert, update, delete on public.pharmacy_catalog_mappings from authenticated;
grant select on public.pharmacy_catalog_items, public.pharmacy_catalog_mappings
  to authenticated, service_role;

create or replace function public.create_pharmacy_catalog_item(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_pharmacy_location_id uuid,
  target_external_sku text,
  target_source_product_name text default null,
  target_source_description text default null,
  target_barcode text default null,
  target_gtin text default null,
  target_nafdac_registration_number text default null,
  target_source_brand text default null,
  target_source_generic_name text default null,
  target_source_ingredients text default null,
  target_source_strength text default null,
  target_source_dosage_form text default null,
  target_source_pack_size text default null,
  target_source_manufacturer text default null,
  target_source_system text default 'manual',
  target_source_record_id text default null
)
returns public.pharmacy_catalog_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.pharmacy_catalog_items;
  location public.pharmacy_locations;
  created public.pharmacy_catalog_items;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ) then
    raise exception 'Actor may not manage the pharmacy catalog for this organization';
  end if;
  if btrim(coalesce(target_external_sku, '')) = '' then
    raise exception 'A local SKU is required';
  end if;

  select * into existing from public.pharmacy_catalog_items
  where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  if found then
    return existing;
  end if;

  select * into location from public.pharmacy_locations
  where id = target_pharmacy_location_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Pharmacy location not found';
  end if;

  begin
    insert into public.pharmacy_catalog_items (
      organization_id, pharmacy_location_id, external_sku, source_product_name,
      source_description, barcode, gtin, nafdac_registration_number, source_brand,
      source_generic_name, source_ingredients, source_strength, source_dosage_form,
      source_pack_size, source_manufacturer, source_system, source_record_id,
      source_updated_at, idempotency_key, created_by
    ) values (
      target_organization_id, target_pharmacy_location_id, target_external_sku,
      target_source_product_name, target_source_description, target_barcode,
      target_gtin, target_nafdac_registration_number, target_source_brand,
      target_source_generic_name, target_source_ingredients, target_source_strength,
      target_source_dosage_form, target_source_pack_size, target_source_manufacturer,
      target_source_system, target_source_record_id, now(), target_idempotency_key,
      target_actor_id
    )
    returning * into created;
  exception when unique_violation then
    raise exception 'This local SKU already exists at this pharmacy location';
  end;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'pharmacy_catalog.create_item', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'pharmacy_catalog_item', created.id::text, null,
    jsonb_build_object('externalSku', created.external_sku, 'pharmacyLocationId', created.pharmacy_location_id),
    null, null, target_channel, 'pharmacy_catalog.item_created',
    jsonb_build_object('itemId', created.id, 'pharmacyLocationId', created.pharmacy_location_id)
  );

  return created;
end;
$$;

revoke all on function public.create_pharmacy_catalog_item(
  uuid, uuid, text, text, text, text, uuid, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.create_pharmacy_catalog_item(
  uuid, uuid, text, text, text, text, uuid, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text
) to authenticated;

-- Any of the roles that may operate the catalog may propose a candidate
-- mapping (today: the same actor entering the SKU manually; a future
-- ingestion pipeline is a separate slice, not this one). Proposing never
-- grants current authority -- only decide_pharmacy_catalog_mapping does.
create or replace function public.propose_pharmacy_catalog_mapping(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_pharmacy_catalog_item_id uuid,
  target_medicine_id uuid,
  target_mapping_status text,
  target_mapping_method text,
  target_confidence numeric default null,
  target_evidence jsonb default '{}'::jsonb
)
returns public.pharmacy_catalog_mappings
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.pharmacy_catalog_mappings;
  item public.pharmacy_catalog_items;
  medicine public.medicines;
  created public.pharmacy_catalog_mappings;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacy_owner',
          'pharmacy_staff', 'inventory_manager']::public.member_role[]
  ) then
    raise exception 'Actor may not manage the pharmacy catalog for this organization';
  end if;
  if target_mapping_status not in ('review_required', 'unmatched', 'conflict') then
    raise exception 'A proposal may only be review_required, unmatched, or conflict';
  end if;

  select * into existing from public.pharmacy_catalog_mappings
  where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  if found then
    return existing;
  end if;

  select * into item from public.pharmacy_catalog_items
  where id = target_pharmacy_catalog_item_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Pharmacy catalog item not found';
  end if;

  select * into medicine from public.medicines
  where id = target_medicine_id and status = 'active';
  if not found then
    raise exception 'Candidate medicine is not an active canonical medicine';
  end if;

  insert into public.pharmacy_catalog_mappings (
    organization_id, pharmacy_catalog_item_id, medicine_id, mapping_status,
    mapping_method, confidence, evidence, idempotency_key
  ) values (
    target_organization_id, target_pharmacy_catalog_item_id, target_medicine_id,
    target_mapping_status::public.pharmacy_catalog_mapping_status,
    target_mapping_method, target_confidence, coalesce(target_evidence, '{}'::jsonb),
    target_idempotency_key
  )
  returning * into created;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'pharmacy_catalog.propose_mapping', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'pharmacy_catalog_mapping', created.id::text, null,
    jsonb_build_object(
      'itemId', target_pharmacy_catalog_item_id, 'medicineId', target_medicine_id,
      'status', created.mapping_status
    ),
    null, null, target_channel, 'pharmacy_catalog.mapping_proposed',
    jsonb_build_object('mappingId', created.id, 'itemId', target_pharmacy_catalog_item_id)
  );

  return created;
end;
$$;

revoke all on function public.propose_pharmacy_catalog_mapping(
  uuid, uuid, text, text, text, text, uuid, uuid, text, text, numeric, jsonb
) from public;
grant execute on function public.propose_pharmacy_catalog_mapping(
  uuid, uuid, text, text, text, text, uuid, uuid, text, text, numeric, jsonb
) to authenticated;

-- Pharmacist-only, matching the existing "generic substitution remains
-- pharmacist-governed" precedent (decide_clinical_review). A confirm
-- always names the medicine explicitly (target_medicine_id), whether or
-- not it matches the original proposal, covering SELECT_DIFFERENT_PRODUCT
-- without a separate action. Superseding a prior current mapping updates
-- it to is_current=false rather than deleting it -- history/provenance
-- survives remapping by construction.
create or replace function public.decide_pharmacy_catalog_mapping(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_pharmacy_catalog_mapping_id uuid,
  target_decision text,
  target_medicine_id uuid default null,
  target_rejection_reason text default null
)
returns public.pharmacy_catalog_mappings
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.pharmacy_catalog_mappings;
  mapping public.pharmacy_catalog_mappings;
  medicine public.medicines;
  decided public.pharmacy_catalog_mappings;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id, array['pharmacist']::public.member_role[]
  ) then
    raise exception 'Only a pharmacist may decide a pharmacy catalog mapping';
  end if;
  if target_decision not in ('confirm', 'reject') then
    raise exception 'Mapping decision must be confirm or reject';
  end if;

  select * into existing from public.pharmacy_catalog_mappings
  where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  if found then
    return existing;
  end if;

  select * into mapping from public.pharmacy_catalog_mappings
  where id = target_pharmacy_catalog_mapping_id and organization_id = target_organization_id
  for update;
  if not found then
    raise exception 'Pharmacy catalog mapping not found';
  end if;
  if mapping.mapping_status not in ('review_required', 'unmatched', 'conflict') then
    raise exception 'Only a proposal awaiting decision may be confirmed or rejected';
  end if;

  if target_decision = 'reject' then
    if btrim(coalesce(target_rejection_reason, '')) = '' then
      raise exception 'A meaningful reason is required to reject a mapping';
    end if;
    update public.pharmacy_catalog_mappings
    set mapping_status = 'rejected', rejected_by = target_actor_id, rejected_at = now(),
      rejection_reason = target_rejection_reason
    where id = mapping.id
    returning * into decided;
  else
    if target_medicine_id is null then
      raise exception 'Confirming a mapping requires an explicit medicine identity';
    end if;
    select * into medicine from public.medicines
    where id = target_medicine_id and status = 'active';
    if not found then
      raise exception 'Confirmed medicine is not an active canonical medicine';
    end if;

    -- Never a second simultaneous current mapping: supersede first,
    -- preserving the prior decision's own row (verified_by/at untouched).
    update public.pharmacy_catalog_mappings
    set is_current = false
    where pharmacy_catalog_item_id = mapping.pharmacy_catalog_item_id
      and organization_id = target_organization_id
      and is_current;

    update public.pharmacy_catalog_mappings
    set mapping_status = 'matched', medicine_id = target_medicine_id, is_current = true,
      verified_by = target_actor_id, verified_at = now()
    where id = mapping.id
    returning * into decided;
  end if;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'pharmacy_catalog.decide_mapping', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'pharmacy_catalog_mapping', decided.id::text,
    jsonb_build_object('status', mapping.mapping_status),
    jsonb_build_object('status', decided.mapping_status, 'medicineId', decided.medicine_id),
    null, null, target_channel, 'pharmacy_catalog.mapping_decided',
    jsonb_build_object('mappingId', decided.id, 'decision', target_decision)
  );

  return decided;
end;
$$;

revoke all on function public.decide_pharmacy_catalog_mapping(
  uuid, uuid, text, text, text, text, uuid, text, uuid, text
) from public;
grant execute on function public.decide_pharmacy_catalog_mapping(
  uuid, uuid, text, text, text, text, uuid, text, uuid, text
) to authenticated;

comment on function public.create_pharmacy_catalog_item is
  'Creates a pharmacy-local catalog item (never canonical medicine identity by itself). Idempotent on (organization_id, idempotency_key). Same authority as inventory_batches management.';
comment on function public.propose_pharmacy_catalog_mapping is
  'Proposes a candidate canonical-medicine mapping for a pharmacy catalog item as review_required, unmatched, or conflict. Never grants current mapping authority.';
comment on function public.decide_pharmacy_catalog_mapping is
  'Pharmacist-only confirm/reject of a proposed mapping. Confirm always names the medicine explicitly and atomically supersedes any prior current mapping for the same item, preserving history. Ambiguous mappings fail closed: only a pharmacist decision can ever set is_current.';
