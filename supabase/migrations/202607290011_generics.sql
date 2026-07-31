-- Wave 2: Generic Medicine Entity.
--
-- Resolves the RC1 gap tracked in docs/audit/RC1_BACKLOG.md P1 items 8 and
-- 13: packages/medicine models GenericMedicine (canonicalName,
-- normalizedName, therapeuticClass, controlled, status) as its own entity,
-- but the schema only ever stored it as a free-text `generic_name` column on
-- each `medicines` (brand) row -- MedicineCatalogReader.findGenericById and
-- SearchMedicineReader.findGenericsByIds have returned null/[] unconditionally
-- since they were written, and TrigramMedicineSearchIndex has silently
-- dropped every "generic" search request.
--
-- This is a different axis from public.active_ingredients: active_ingredients
-- models the pharmacological substance used for ingredient-based equivalency
-- matching (CatalogEquivalencyService.propose(), via medicine_ingredients),
-- which is unchanged by this migration. public.generics models the marketed
-- generic-name catalog entity GenericMedicine represents, for browse/search
-- and future write paths -- not equivalency.
--
-- medicines.generic_name (text) is kept rather than dropped: existing read
-- paths (apps/admin catalog list/get, docs/wave-2-certification.md "known
-- gaps") depend on it directly and it is the authoritative display value on
-- the brand row; medicines.generic_id is an additive link to the new
-- first-class entity.

create table public.generics (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique check (char_length(canonical_name) between 2 and 200),
  normalized_name text not null check (char_length(normalized_name) between 2 and 200),
  therapeutic_class_id uuid references public.therapeutic_classes(id),
  controlled_substance boolean not null default false,
  status public.medicine_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index generics_normalized_name_idx
  on public.generics(normalized_name)
  where deleted_at is null;
create index generics_name_trgm_idx
  on public.generics using gin (canonical_name gin_trgm_ops)
  where deleted_at is null;
create index generics_class_idx
  on public.generics(therapeutic_class_id)
  where deleted_at is null;

alter table public.medicines
  add column generic_id uuid references public.generics(id);

create index medicines_generic_id_idx
  on public.medicines(generic_id)
  where deleted_at is null;

-- Backfill: one generics row per distinct normalized generic_name already on
-- medicines. controlled_substance is true if any brand sharing that generic
-- name is controlled; therapeutic_class_id picks the first non-null value
-- among them (brands sharing a generic name have not disagreed on class in
-- any data this schema has produced so far, but the aggregate is defensive
-- rather than assumed).
insert into public.generics (canonical_name, normalized_name, therapeutic_class_id, controlled_substance, status)
select
  min(trim(medicine.generic_name)) as canonical_name,
  lower(trim(medicine.generic_name)) as normalized_name,
  (array_agg(medicine.therapeutic_class_id order by medicine.therapeutic_class_id nulls last))[1] as therapeutic_class_id,
  bool_or(medicine.controlled_substance) as controlled_substance,
  'active'::public.medicine_record_status
from public.medicines medicine
where medicine.deleted_at is null
group by lower(trim(medicine.generic_name));

update public.medicines medicine
set generic_id = generic.id
from public.generics generic
where generic.normalized_name = lower(trim(medicine.generic_name))
  and medicine.deleted_at is null;

-- Keeps generic_id in sync for every future insert/update going forward,
-- the same "orchestrate via trigger" approach sync_inventory_lock_quantity
-- (migration 202607270003) already established, rather than duplicating
-- find-or-create logic inside create_medicine_record/update_medicine_record
-- (202607290008) or every future write path.
create or replace function public.sync_medicine_generic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_generic_id uuid;
  normalized text := lower(trim(new.generic_name));
begin
  select id into resolved_generic_id
  from public.generics
  where normalized_name = normalized and deleted_at is null;

  if resolved_generic_id is null then
    insert into public.generics (canonical_name, normalized_name, controlled_substance, status)
    values (trim(new.generic_name), normalized, coalesce(new.controlled_substance, false), 'active')
    returning id into resolved_generic_id;
  end if;

  new.generic_id = resolved_generic_id;
  return new;
end;
$$;

create trigger medicines_sync_generic
before insert or update of generic_name on public.medicines
for each row execute function public.sync_medicine_generic();

create trigger generics_set_updated_at
before update on public.generics
for each row execute function public.set_updated_at();

alter table public.generics enable row level security;

create policy generics_read
  on public.generics for select to authenticated
  using (deleted_at is null);
create policy generics_admin
  on public.generics for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

comment on table public.generics is
  'First-class generic-medicine catalog entity backing packages/medicine''s GenericMedicine; kept in sync with medicines.generic_name by sync_medicine_generic().';
