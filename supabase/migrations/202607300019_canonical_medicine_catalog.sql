-- RC2 MVP: canonical medicine catalogue completion.
--
-- Extends the existing global medicine knowledge model with deterministic
-- strength normalization, governed dosage forms, immutable version history,
-- complete ranked search, and atomic administration commands.

create or replace function public.normalize_medicine_strength(value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  normalized text;
begin
  normalized := regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              replace(replace(btrim(value), 'μ', 'u'), 'µ', 'u'),
              '[[:space:]]+',
              ' ',
              'g'
            ),
            '[[:space:]]*/[[:space:]]*',
            '/',
            'g'
          ),
          '[[:space:]]*%[[:space:]]*',
          '%',
          'g'
        ),
        '(^|[^[:alpha:]])(UG|MCG)([^[:alpha:]]|$)',
        '\1mcg\3',
        'gi'
      ),
      '(^|[^[:alpha:]])ML([^[:alpha:]]|$)',
      '\1mL\2',
      'gi'
    ),
    '(^|[^[:alpha:]])IU([^[:alpha:]]|$)',
    '\1IU\2',
    'gi'
  );
  normalized := regexp_replace(
    normalized,
    '([0-9]+\.[0-9]*[1-9])0+([^0-9]|$)',
    '\1\2',
    'g'
  );
  return regexp_replace(
    normalized,
    '([0-9]+)\.0+([^0-9]|$)',
    '\1\2',
    'g'
  );
end;
$$;

revoke all on function public.normalize_medicine_strength(text) from public;
grant execute on function public.normalize_medicine_strength(text)
  to authenticated, service_role;

alter table public.medicines
  add column strength_normalized text generated always as (
    public.normalize_medicine_strength(strength_display)
  ) stored,
  add column catalog_version integer not null default 1,
  add column merged_into_id uuid references public.medicines(id);

alter table public.medicines
  add constraint medicines_catalog_version_positive check (catalog_version > 0),
  add constraint medicines_not_merged_into_self check (
    merged_into_id is null or merged_into_id <> id
  );

create index medicines_strength_normalized_idx
  on public.medicines(strength_normalized)
  where deleted_at is null;
create index medicines_merged_into_idx
  on public.medicines(merged_into_id)
  where merged_into_id is not null;

create table public.medicine_dosage_forms (
  code text primary key check (char_length(btrim(code)) between 2 and 100),
  display_name text not null check (
    char_length(btrim(display_name)) between 2 and 120
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.medicine_dosage_forms (code, display_name)
values
  ('tablet', 'Tablet'),
  ('capsule', 'Capsule'),
  ('injection', 'Injection'),
  ('cream', 'Cream'),
  ('ointment', 'Ointment'),
  ('syrup', 'Syrup'),
  ('solution', 'Solution'),
  ('suspension', 'Suspension'),
  ('drops', 'Drops'),
  ('inhaler', 'Inhaler'),
  ('suppository', 'Suppository'),
  ('patch', 'Patch')
on conflict (code) do nothing;

insert into public.medicine_dosage_forms (code, display_name)
select distinct medicine.dosage_form, initcap(medicine.dosage_form)
from public.medicines medicine
where btrim(medicine.dosage_form) <> ''
on conflict (code) do nothing;

alter table public.medicines
  add constraint medicines_dosage_form_fk
  foreign key (dosage_form)
  references public.medicine_dosage_forms(code);

alter table public.medicine_dosage_forms enable row level security;

create policy medicine_dosage_forms_read
  on public.medicine_dosage_forms for select to authenticated
  using (is_active);
create policy medicine_dosage_forms_admin
  on public.medicine_dosage_forms for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create trigger medicine_dosage_forms_set_updated_at
before update on public.medicine_dosage_forms
for each row execute function public.set_updated_at();

-- Tighten legacy read policies so nested catalogue metadata cannot reveal a
-- draft or retired medicine to an ordinary authenticated user.
drop policy medicine_registrations_read on public.medicine_registrations;
create policy medicine_registrations_read
  on public.medicine_registrations for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.medicines medicine
      where medicine.id = medicine_id
        and medicine.status = 'active'
        and medicine.deleted_at is null
    )
  );

drop policy medicine_equivalences_read on public.medicine_equivalences;
create policy medicine_equivalences_read
  on public.medicine_equivalences for select to authenticated
  using (
    deleted_at is null
    and status = 'active'
    and exists (
      select 1
      from public.medicines source
      join public.medicines alternative
        on alternative.id = equivalent_medicine_id
      where source.id = source_medicine_id
        and source.status = 'active'
        and source.deleted_at is null
        and alternative.status = 'active'
        and alternative.deleted_at is null
    )
  );

create table public.medicine_catalog_versions (
  id bigint generated always as identity primary key,
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  version integer not null check (version > 0),
  action text not null check (action in ('created', 'updated', 'merged')),
  snapshot jsonb not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  unique (medicine_id, version),
  check (
    snapshot::text !~*
      '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  )
);

create index medicine_catalog_versions_timeline_idx
  on public.medicine_catalog_versions(medicine_id, version desc);

-- Backfill the current catalogue without inventing an actor.
insert into public.medicine_catalog_versions (
  medicine_id, version, action, snapshot
)
select
  medicine.id,
  medicine.catalog_version,
  'created',
  to_jsonb(medicine) - array['image_url']
from public.medicines medicine;

alter table public.medicine_catalog_versions enable row level security;

create policy medicine_catalog_versions_admin_read
  on public.medicine_catalog_versions for select to authenticated
  using (public.is_platform_admin());

create or replace function public.prevent_medicine_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'medicine catalogue versions are append-only';
end;
$$;

create trigger medicine_catalog_versions_append_only
before update or delete on public.medicine_catalog_versions
for each row execute function public.prevent_medicine_version_mutation();

create or replace function public.version_medicine_catalog_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.catalog_version := old.catalog_version + 1;
  else
    new.catalog_version := 1;
  end if;
  return new;
end;
$$;

create trigger medicines_catalog_version_guard
before insert or update on public.medicines
for each row execute function public.version_medicine_catalog_record();

create or replace function public.record_medicine_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.medicine_catalog_versions (
    medicine_id, version, action, snapshot, changed_by
  ) values (
    new.id,
    new.catalog_version,
    case
      when tg_op = 'INSERT' then 'created'
      when new.merged_into_id is distinct from old.merged_into_id then 'merged'
      else 'updated'
    end,
    to_jsonb(new) - array['image_url'],
    auth.uid()
  );
  return new;
end;
$$;

create trigger medicines_catalog_version_record
after insert or update on public.medicines
for each row execute function public.record_medicine_catalog_version();

comment on table public.medicine_catalog_versions is
  'Immutable, administrator-readable snapshots of the canonical medicine master. Image URLs are excluded from historical evidence.';

create or replace function public.search_medicines(
  search_term text,
  requested_types text[] default array['brand', 'generic'],
  result_limit integer default 20,
  result_offset integer default 0
)
returns table (
  entity_id uuid,
  entity_type text,
  relevance double precision,
  matched_on text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with normalized as (
    select lower(btrim(search_term)) as term
  ),
  candidates as (
    select
      medicine.id as entity_id,
      'brand'::text as entity_type,
      case
        when lower(medicine.brand_name) = normalized.term then 1.0
        when lower(medicine.brand_name) like normalized.term || '%' then 0.95
        else extensions.similarity(
          lower(medicine.brand_name),
          normalized.term
        )
      end::double precision as relevance,
      'brand'::text as matched_on
    from public.medicines medicine
    cross join normalized
    where 'brand' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        lower(medicine.brand_name) = normalized.term
        or medicine.brand_name operator(extensions.%) search_term
        or medicine.brand_name ilike '%' || search_term || '%'
      )

    union all

    select
      medicine.id,
      'generic',
      case
        when lower(medicine.generic_name) = normalized.term then 1.0
        when lower(medicine.generic_name) like normalized.term || '%' then 0.95
        else extensions.similarity(
          lower(medicine.generic_name),
          normalized.term
        )
      end::double precision,
      'generic'
    from public.medicines medicine
    cross join normalized
    where 'generic' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        lower(medicine.generic_name) = normalized.term
        or medicine.generic_name operator(extensions.%) search_term
        or medicine.generic_name ilike '%' || search_term || '%'
      )

    union all

    select
      medicine.id,
      'brand',
      case
        when lower(ingredient.preferred_name) = normalized.term then 0.99
        when lower(ingredient.preferred_name) like normalized.term || '%'
          then 0.94
        else extensions.similarity(
          lower(ingredient.preferred_name),
          normalized.term
        )
      end::double precision,
      'ingredient'
    from public.medicines medicine
    join public.medicine_ingredients relation
      on relation.medicine_id = medicine.id
    join public.active_ingredients ingredient
      on ingredient.id = relation.active_ingredient_id
     and ingredient.deleted_at is null
    cross join normalized
    where 'ingredient' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        lower(ingredient.preferred_name) = normalized.term
        or ingredient.preferred_name operator(extensions.%) search_term
        or ingredient.preferred_name ilike '%' || search_term || '%'
      )

    union all

    select
      medicine.id,
      'brand',
      case
        when lower(medicine.manufacturer_name) = normalized.term then 0.98
        when lower(medicine.manufacturer_name) like normalized.term || '%'
          then 0.93
        else extensions.similarity(
          lower(medicine.manufacturer_name),
          normalized.term
        )
      end::double precision,
      'manufacturer'
    from public.medicines medicine
    cross join normalized
    where 'manufacturer' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and medicine.manufacturer_name is not null
      and (
        lower(medicine.manufacturer_name) = normalized.term
        or medicine.manufacturer_name operator(extensions.%) search_term
        or medicine.manufacturer_name ilike '%' || search_term || '%'
      )

    union all

    select
      medicine.id,
      'brand',
      case
        when lower(registration.registration_number) = normalized.term
          then 0.99
        when lower(registration.registration_number)
          like normalized.term || '%' then 0.94
        else extensions.similarity(
          lower(registration.registration_number),
          normalized.term
        )
      end::double precision,
      'registration'
    from public.medicines medicine
    join public.medicine_registrations registration
      on registration.medicine_id = medicine.id
     and registration.deleted_at is null
    cross join normalized
    where 'registration' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        lower(registration.registration_number) = normalized.term
        or registration.registration_number ilike '%' || search_term || '%'
      )

    union all

    select
      medicine.id,
      'brand',
      case
        when lower(alias.alias) = normalized.term then 0.99
        when lower(alias.alias) like normalized.term || '%' then 0.94
        else extensions.similarity(lower(alias.alias), normalized.term)
      end::double precision,
      'synonym'
    from public.medicines medicine
    join public.medicine_aliases alias on alias.medicine_id = medicine.id
    cross join normalized
    where 'synonym' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        lower(alias.alias) = normalized.term
        or alias.alias operator(extensions.%) search_term
        or alias.alias ilike '%' || search_term || '%'
      )
  ),
  ranked as (
    select distinct on (candidate.entity_id)
      candidate.entity_id,
      candidate.entity_type,
      candidate.relevance,
      candidate.matched_on
    from candidates candidate
    order by
      candidate.entity_id,
      candidate.relevance desc,
      candidate.entity_type,
      candidate.matched_on
  )
  select ranked.entity_id, ranked.entity_type, ranked.relevance, ranked.matched_on
  from ranked
  order by ranked.relevance desc, ranked.entity_type, ranked.entity_id
  limit greatest(1, least(result_limit, 101))
  offset greatest(0, result_offset);
$$;

revoke all on function public.search_medicines(text, text[], integer, integer)
  from public;
grant execute on function public.search_medicines(
  text, text[], integer, integer
) to authenticated;

create or replace function public.create_catalog_ingredient(
  target_organization_id uuid,
  target_preferred_name text,
  target_description text,
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
  created_ingredient_id uuid;
  existing_event record;
  content_hash text;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_preferred_name is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or not public.is_platform_admin()
     or not public.is_organization_member(target_organization_id)
     or char_length(btrim(target_preferred_name)) not between 2 and 200
     or (
       target_description is not null
       and char_length(btrim(target_description)) not between 1 and 2000
     )
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid active ingredient context'
      using errcode = '22023';
  end if;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'preferredName', btrim(target_preferred_name),
          'description', nullif(btrim(target_description), '')
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key =
      target_idempotency_key || ':ingredient-created';

  if found then
    if existing_event.payload->>'contentSha256' is distinct from content_hash
    then
      raise exception 'catalogue ingredient idempotency conflict'
        using errcode = '23505';
    end if;
    return existing_event.payload;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower(btrim(target_preferred_name)), 0)
  );
  if exists (
    select 1
    from public.active_ingredients ingredient
    where lower(ingredient.preferred_name) =
      lower(btrim(target_preferred_name))
      and ingredient.deleted_at is null
  ) then
    raise exception 'active ingredient already exists'
      using errcode = '23505';
  end if;

  insert into public.active_ingredients (preferred_name, description)
  values (
    btrim(target_preferred_name),
    nullif(btrim(target_description), '')
  )
  returning id into created_ingredient_id;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    'medicine.ingredient-created.v1',
    'active_ingredient',
    created_ingredient_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'ingredientId', created_ingredient_id,
      'contentSha256', content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':ingredient-created'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'medicine.catalog',
    'user',
    auth.uid()::text,
    'active_ingredient',
    created_ingredient_id::text,
    'ingredient.create',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-ingredient-created',
    'web',
    jsonb_build_object('contentSha256', content_hash)
  );

  return jsonb_build_object(
    'ingredientId', created_ingredient_id,
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.create_catalog_ingredient(
  uuid, text, text, text, text, text
) from public;
grant execute on function public.create_catalog_ingredient(
  uuid, text, text, text, text, text
) to authenticated;

create or replace function public.save_catalog_medicine(
  target_organization_id uuid,
  target_medicine_id uuid,
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
  medicine_row record;
  item_row record;
  existing_event record;
  created_medicine_id uuid;
  resulting_version integer;
  content_hash text;
  event_type text;
  action_name text;
  registration_count integer;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_document is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or not public.is_platform_admin()
     or not public.is_organization_member(target_organization_id)
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
     or jsonb_typeof(target_document) <> 'object'
     or not target_document ?& array[
       'brandName', 'genericName', 'dosageForm', 'route', 'strength',
       'controlled', 'status', 'aliases', 'ingredients', 'registrations'
     ]
     or (
       target_document
       - array[
           'brandName', 'genericName', 'therapeuticClassId', 'dosageForm',
           'route', 'strength', 'packSize', 'manufacturer', 'controlled',
           'status', 'aliases', 'ingredients', 'registrations'
         ]
     ) <> '{}'::jsonb
     or jsonb_typeof(target_document->'brandName') <> 'string'
     or char_length(btrim(target_document->>'brandName')) not between 2 and 200
     or jsonb_typeof(target_document->'genericName') <> 'string'
     or char_length(btrim(target_document->>'genericName'))
       not between 2 and 300
     or jsonb_typeof(target_document->'dosageForm') <> 'string'
     or char_length(btrim(target_document->>'dosageForm'))
       not between 2 and 100
     or jsonb_typeof(target_document->'route') <> 'string'
     or char_length(btrim(target_document->>'route')) not between 2 and 100
     or jsonb_typeof(target_document->'strength') <> 'string'
     or char_length(btrim(target_document->>'strength')) not between 1 and 100
     or jsonb_typeof(target_document->'controlled') <> 'boolean'
     or target_document->>'status' not in ('draft', 'active', 'retired')
     or jsonb_typeof(target_document->'aliases') <> 'array'
     or jsonb_array_length(target_document->'aliases') > 50
     or jsonb_typeof(target_document->'ingredients') <> 'array'
     or jsonb_array_length(target_document->'ingredients') not between 1 and 20
     or jsonb_typeof(target_document->'registrations') <> 'array'
     or jsonb_array_length(target_document->'registrations') > 20
     or (
       target_document ? 'therapeuticClassId'
       and target_document->'therapeuticClassId' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'therapeuticClassId') <> 'string'
         or (target_document->>'therapeuticClassId') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       )
     )
     or (
       target_document ? 'packSize'
       and target_document->'packSize' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'packSize') <> 'string'
         or char_length(btrim(target_document->>'packSize'))
           not between 1 and 160
       )
     )
     or (
       target_document ? 'manufacturer'
       and target_document->'manufacturer' <> 'null'::jsonb
       and (
         jsonb_typeof(target_document->'manufacturer') <> 'string'
         or char_length(btrim(target_document->>'manufacturer'))
           not between 1 and 200
       )
     )
  then
    raise exception 'invalid canonical medicine document'
      using errcode = '22023';
  end if;

  registration_count := jsonb_array_length(
    target_document->'registrations'
  );
  if target_document->>'status' = 'active' and registration_count = 0 then
    raise exception 'active medicine requires a regulatory registration'
      using errcode = '22023';
  end if;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'medicineId', target_medicine_id,
          'expectedVersion', target_expected_version,
          'document', target_document
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':saved';

  if found then
    if existing_event.payload->>'contentSha256' is distinct from content_hash
    then
      raise exception 'catalog save idempotency conflict'
        using errcode = '23505';
    end if;
    return existing_event.payload;
  end if;

  if target_medicine_id is null then
    if target_expected_version is not null then
      raise exception 'new medicine cannot have an expected version'
        using errcode = '22023';
    end if;
    insert into public.medicines (
      brand_name, generic_name, therapeutic_class_id, dosage_form, route,
      strength_display, pack_size, manufacturer_name, controlled_substance,
      status
    ) values (
      btrim(target_document->>'brandName'),
      btrim(target_document->>'genericName'),
      (target_document->>'therapeuticClassId')::uuid,
      btrim(target_document->>'dosageForm'),
      btrim(target_document->>'route'),
      btrim(target_document->>'strength'),
      nullif(btrim(target_document->>'packSize'), ''),
      nullif(btrim(target_document->>'manufacturer'), ''),
      (target_document->>'controlled')::boolean,
      (target_document->>'status')::public.medicine_record_status
    )
    returning id, catalog_version into created_medicine_id, resulting_version;
    event_type := 'medicine.catalog-created.v1';
    action_name := 'catalog.create';
  else
    select medicine.* into strict medicine_row
    from public.medicines medicine
    where medicine.id = target_medicine_id
      and medicine.merged_into_id is null
    for update;

    if target_expected_version is null
       or medicine_row.catalog_version <> target_expected_version
    then
      raise exception 'catalog medicine version conflict'
        using errcode = '40001';
    end if;

    update public.medicines
    set brand_name = btrim(target_document->>'brandName'),
        generic_name = btrim(target_document->>'genericName'),
        therapeutic_class_id =
          (target_document->>'therapeuticClassId')::uuid,
        dosage_form = btrim(target_document->>'dosageForm'),
        route = btrim(target_document->>'route'),
        strength_display = btrim(target_document->>'strength'),
        pack_size = nullif(btrim(target_document->>'packSize'), ''),
        manufacturer_name =
          nullif(btrim(target_document->>'manufacturer'), ''),
        controlled_substance =
          (target_document->>'controlled')::boolean,
        status =
          (target_document->>'status')::public.medicine_record_status,
        deleted_at = null
    where id = target_medicine_id
    returning id, catalog_version into created_medicine_id, resulting_version;

    delete from public.medicine_ingredients
    where medicine_id = created_medicine_id;
    delete from public.medicine_aliases
    where medicine_id = created_medicine_id;
    delete from public.medicine_registrations
    where medicine_id = created_medicine_id;
    event_type := 'medicine.catalog-updated.v1';
    action_name := 'catalog.update';
  end if;

  for item_row in
    select ingredient.value, ingredient.ordinality
    from jsonb_array_elements(target_document->'ingredients')
      with ordinality ingredient(value, ordinality)
  loop
    if jsonb_typeof(item_row.value) <> 'object'
       or (
         item_row.value
         - array['ingredientId', 'amount', 'unit', 'primary']
       ) <> '{}'::jsonb
       or jsonb_typeof(item_row.value->'ingredientId') <> 'string'
       or (item_row.value->>'ingredientId') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or jsonb_typeof(item_row.value->'primary') <> 'boolean'
       or (
         item_row.value ? 'amount'
         and item_row.value->'amount' <> 'null'::jsonb
         and (
           jsonb_typeof(item_row.value->'amount') <> 'number'
           or (item_row.value->>'amount')::numeric <= 0
         )
       )
       or (
         item_row.value ? 'unit'
         and item_row.value->'unit' <> 'null'::jsonb
         and (
           jsonb_typeof(item_row.value->'unit') <> 'string'
           or char_length(btrim(item_row.value->>'unit'))
             not between 1 and 80
         )
       )
    then
      raise exception 'invalid active ingredient at position %',
        item_row.ordinality
        using errcode = '22023';
    end if;

    insert into public.medicine_ingredients (
      medicine_id, active_ingredient_id, amount, unit, is_primary
    ) values (
      created_medicine_id,
      (item_row.value->>'ingredientId')::uuid,
      (item_row.value->>'amount')::numeric,
      nullif(btrim(item_row.value->>'unit'), ''),
      (item_row.value->>'primary')::boolean
    );
  end loop;

  if not exists (
    select 1
    from public.medicine_ingredients ingredient
    where ingredient.medicine_id = created_medicine_id
      and ingredient.is_primary
  ) then
    raise exception 'medicine requires a primary active ingredient'
      using errcode = '22023';
  end if;

  for item_row in
    select alias.value, alias.ordinality
    from jsonb_array_elements(target_document->'aliases')
      with ordinality alias(value, ordinality)
  loop
    if jsonb_typeof(item_row.value) <> 'string'
       or char_length(btrim(item_row.value #>> '{}')) not between 2 and 300
    then
      raise exception 'invalid medicine alias at position %',
        item_row.ordinality
        using errcode = '22023';
    end if;
    insert into public.medicine_aliases (medicine_id, alias)
    values (created_medicine_id, btrim(item_row.value #>> '{}'))
    on conflict (medicine_id, alias, locale) do nothing;
  end loop;

  for item_row in
    select registration.value, registration.ordinality
    from jsonb_array_elements(target_document->'registrations')
      with ordinality registration(value, ordinality)
  loop
    if jsonb_typeof(item_row.value) <> 'object'
       or (
         item_row.value
         - array[
             'countryCode', 'authorityCode', 'registrationNumber',
             'validFrom', 'validUntil'
           ]
       ) <> '{}'::jsonb
       or (item_row.value->>'countryCode') !~ '^[A-Z]{2}$'
       or char_length(btrim(item_row.value->>'authorityCode'))
         not between 2 and 40
       or char_length(btrim(item_row.value->>'registrationNumber'))
         not between 1 and 160
       or (
         item_row.value ? 'validFrom'
         and item_row.value->'validFrom' <> 'null'::jsonb
         and (item_row.value->>'validFrom') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       )
       or (
         item_row.value ? 'validUntil'
         and item_row.value->'validUntil' <> 'null'::jsonb
         and (item_row.value->>'validUntil') !~
           '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       )
       or (
         item_row.value->>'validFrom' is not null
         and item_row.value->>'validUntil' is not null
         and (item_row.value->>'validUntil')::date
           < (item_row.value->>'validFrom')::date
       )
    then
      raise exception 'invalid medicine registration at position %',
        item_row.ordinality
        using errcode = '22023';
    end if;

    insert into public.medicine_registrations (
      medicine_id, country_code, authority_code, registration_number,
      valid_from, valid_until
    ) values (
      created_medicine_id,
      item_row.value->>'countryCode',
      btrim(item_row.value->>'authorityCode'),
      btrim(item_row.value->>'registrationNumber'),
      (item_row.value->>'validFrom')::date,
      (item_row.value->>'validUntil')::date
    );
  end loop;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    event_type,
    'medicine',
    created_medicine_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'medicineId', created_medicine_id,
      'version', resulting_version,
      'status', target_document->>'status',
      'contentSha256', content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':saved'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'medicine.catalog',
    'user',
    auth.uid()::text,
    'medicine',
    created_medicine_id::text,
    action_name,
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-saved',
    'web',
    jsonb_build_object(
      'version', resulting_version,
      'status', target_document->>'status',
      'contentSha256', content_hash,
      'ingredientCount',
        jsonb_array_length(target_document->'ingredients'),
      'registrationCount', registration_count
    )
  );

  return jsonb_build_object(
    'medicineId', created_medicine_id,
    'version', resulting_version,
    'status', target_document->>'status',
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.save_catalog_medicine(
  uuid, uuid, integer, jsonb, text, text, text
) from public;
grant execute on function public.save_catalog_medicine(
  uuid, uuid, integer, jsonb, text, text, text
) to authenticated;

alter table public.medicine_equivalences
  add column clinical_notes text,
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz,
  add column effective_from date;

update public.medicine_equivalences
set approved_by = created_by,
    approved_at = created_at,
    effective_from = created_at::date
where status = 'active'::public.medicine_record_status
  and created_by is not null;

alter table public.medicine_equivalences
  add constraint medicine_equivalences_clinical_notes_length check (
    clinical_notes is null
    or char_length(btrim(clinical_notes)) between 1 and 4000
  ),
  add constraint medicine_equivalences_approval_shape check (
    (
      approved_by is null
      and approved_at is null
      and effective_from is null
    )
    or
    (
      approved_by is not null
      and approved_at is not null
      and effective_from is not null
    )
  );

create or replace function public.create_catalog_alternative(
  target_organization_id uuid,
  target_source_medicine_id uuid,
  target_alternative_medicine_id uuid,
  target_kind public.equivalence_kind,
  target_rationale text,
  target_clinical_notes text,
  target_effective_from date,
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
  created_alternative_id uuid;
  existing_event record;
  content_hash text;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_source_medicine_id is null
     or target_alternative_medicine_id is null
     or target_rationale is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or not public.is_platform_admin()
     or not public.is_organization_member(target_organization_id)
     or target_source_medicine_id = target_alternative_medicine_id
     or char_length(btrim(target_rationale)) not between 3 and 2000
     or (
       target_clinical_notes is not null
       and char_length(btrim(target_clinical_notes)) not between 1 and 4000
     )
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
     or target_kind is null
  then
    raise exception 'invalid catalogue alternative context'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.medicines medicine
    where medicine.id in (
      target_source_medicine_id,
      target_alternative_medicine_id
    )
      and medicine.status = 'active'::public.medicine_record_status
      and medicine.deleted_at is null
  ) <> 2 then
    raise exception 'catalogue alternatives must reference active medicines'
      using errcode = '23503';
  end if;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'sourceMedicineId', target_source_medicine_id,
          'alternativeMedicineId', target_alternative_medicine_id,
          'kind', target_kind,
          'rationale', btrim(target_rationale),
          'clinicalNotes', nullif(btrim(target_clinical_notes), ''),
          'effectiveFrom', coalesce(target_effective_from, current_date)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':alternative';

  if found then
    if existing_event.payload->>'contentSha256' is distinct from content_hash
    then
      raise exception 'catalogue alternative idempotency conflict'
        using errcode = '23505';
    end if;
    return existing_event.payload;
  end if;

  insert into public.medicine_equivalences (
    source_medicine_id, equivalent_medicine_id, kind, rationale,
    clinical_notes, requires_pharmacist_review, status, created_by,
    approved_by, approved_at, effective_from
  ) values (
    target_source_medicine_id,
    target_alternative_medicine_id,
    target_kind,
    btrim(target_rationale),
    nullif(btrim(target_clinical_notes), ''),
    true,
    'active',
    auth.uid(),
    auth.uid(),
    now(),
    coalesce(target_effective_from, current_date)
  )
  returning id into created_alternative_id;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    'medicine.alternative-created.v1',
    'medicine',
    target_source_medicine_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'alternativeId', created_alternative_id,
      'sourceMedicineId', target_source_medicine_id,
      'alternativeMedicineId', target_alternative_medicine_id,
      'kind', target_kind,
      'requiresPharmacistReview', true,
      'contentSha256', content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':alternative'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'medicine.catalog',
    'user',
    auth.uid()::text,
    'medicine_alternative',
    created_alternative_id::text,
    'alternative.create',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-alternative',
    'web',
    jsonb_build_object(
      'sourceMedicineId', target_source_medicine_id,
      'alternativeMedicineId', target_alternative_medicine_id,
      'kind', target_kind,
      'requiresPharmacistReview', true,
      'contentSha256', content_hash
    )
  );

  return jsonb_build_object(
    'alternativeId', created_alternative_id,
    'sourceMedicineId', target_source_medicine_id,
    'alternativeMedicineId', target_alternative_medicine_id,
    'kind', target_kind,
    'requiresPharmacistReview', true,
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.create_catalog_alternative(
  uuid, uuid, uuid, public.equivalence_kind, text, text, date,
  text, text, text
) from public;
grant execute on function public.create_catalog_alternative(
  uuid, uuid, uuid, public.equivalence_kind, text, text, date,
  text, text, text
) to authenticated;

create or replace function public.merge_catalog_medicines(
  target_organization_id uuid,
  target_source_medicine_id uuid,
  target_medicine_id uuid,
  target_expected_source_version integer,
  target_expected_version integer,
  target_rationale text,
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
  source_row record;
  target_row record;
  existing_event record;
  content_hash text;
  source_version integer;
  resulting_version integer;
begin
  if auth.uid() is null
     or target_organization_id is null
     or target_rationale is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or not public.is_platform_admin()
     or not public.is_organization_member(target_organization_id)
     or target_source_medicine_id is null
     or target_medicine_id is null
     or target_source_medicine_id = target_medicine_id
     or target_expected_source_version is null
     or target_expected_version is null
     or target_expected_source_version < 1
     or target_expected_version < 1
     or char_length(btrim(target_rationale)) not between 10 and 2000
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid catalogue merge context'
      using errcode = '22023';
  end if;

  content_hash := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'sourceMedicineId', target_source_medicine_id,
          'targetMedicineId', target_medicine_id,
          'sourceVersion', target_expected_source_version,
          'targetVersion', target_expected_version,
          'rationale', btrim(target_rationale)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':merged';

  if found then
    if existing_event.payload->>'contentSha256' is distinct from content_hash
    then
      raise exception 'catalogue merge idempotency conflict'
        using errcode = '23505';
    end if;
    return existing_event.payload;
  end if;

  perform 1
  from public.medicines medicine
  where medicine.id in (target_source_medicine_id, target_medicine_id)
  order by medicine.id
  for update;

  select medicine.* into strict source_row
  from public.medicines medicine
  where medicine.id = target_source_medicine_id
    and medicine.deleted_at is null
    and medicine.merged_into_id is null;

  select medicine.* into strict target_row
  from public.medicines medicine
  where medicine.id = target_medicine_id
    and medicine.deleted_at is null
    and medicine.merged_into_id is null;

  if source_row.catalog_version <> target_expected_source_version
     or target_row.catalog_version <> target_expected_version
  then
    raise exception 'catalogue merge version conflict'
      using errcode = '40001';
  end if;

  if lower(source_row.generic_name) <> lower(target_row.generic_name)
     or source_row.strength_normalized <> target_row.strength_normalized
     or lower(source_row.dosage_form) <> lower(target_row.dosage_form)
     or lower(source_row.route) <> lower(target_row.route)
     or source_row.controlled_substance <> target_row.controlled_substance
  then
    raise exception 'only clinically identical catalogue duplicates may merge'
      using errcode = '22023';
  end if;

  if exists (
    (
      select
        ingredient.active_ingredient_id,
        ingredient.amount,
        ingredient.unit,
        ingredient.is_primary
      from public.medicine_ingredients ingredient
      where ingredient.medicine_id = target_source_medicine_id
      except
      select
        ingredient.active_ingredient_id,
        ingredient.amount,
        ingredient.unit,
        ingredient.is_primary
      from public.medicine_ingredients ingredient
      where ingredient.medicine_id = target_medicine_id
    )
    union all
    (
      select
        ingredient.active_ingredient_id,
        ingredient.amount,
        ingredient.unit,
        ingredient.is_primary
      from public.medicine_ingredients ingredient
      where ingredient.medicine_id = target_medicine_id
      except
      select
        ingredient.active_ingredient_id,
        ingredient.amount,
        ingredient.unit,
        ingredient.is_primary
      from public.medicine_ingredients ingredient
      where ingredient.medicine_id = target_source_medicine_id
    )
  ) then
    raise exception 'catalogue duplicates have different active ingredients'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.inventory_batches source_batch
    join public.inventory_batches target_batch
      on target_batch.organization_id = source_batch.organization_id
     and target_batch.pharmacy_location_id =
       source_batch.pharmacy_location_id
     and target_batch.batch_number = source_batch.batch_number
     and target_batch.medicine_id = target_medicine_id
    where source_batch.medicine_id = target_source_medicine_id
  ) then
    raise exception 'catalogue merge would collide inventory batches'
      using errcode = '23505';
  end if;

  insert into public.medicine_aliases (medicine_id, alias, locale)
  select target_medicine_id, alias.alias, alias.locale
  from public.medicine_aliases alias
  where alias.medicine_id = target_source_medicine_id
  on conflict (medicine_id, alias, locale) do nothing;

  update public.medicine_registrations
  set medicine_id = target_medicine_id
  where medicine_id = target_source_medicine_id;

  update public.prescription_items
  set medicine_id = target_medicine_id
  where medicine_id = target_source_medicine_id;

  update public.medication_access_requests
  set requested_medicine_id = target_medicine_id
  where requested_medicine_id = target_source_medicine_id;

  perform pg_catalog.set_config('medlink.catalog_merge', 'on', true);
  update public.inventory_batches
  set medicine_id = target_medicine_id
  where medicine_id = target_source_medicine_id;

  update public.adherence_schedules
  set medicine_id = target_medicine_id
  where medicine_id = target_source_medicine_id;

  insert into public.medicine_equivalences (
    source_medicine_id, equivalent_medicine_id, kind, rationale, evidence,
    requires_pharmacist_review, status, created_by, clinical_notes,
    approved_by, approved_at, effective_from
  )
  select
    case
      when equivalence.source_medicine_id = target_source_medicine_id
        then target_medicine_id
      else equivalence.source_medicine_id
    end,
    case
      when equivalence.equivalent_medicine_id = target_source_medicine_id
        then target_medicine_id
      else equivalence.equivalent_medicine_id
    end,
    equivalence.kind,
    equivalence.rationale,
    equivalence.evidence,
    true,
    equivalence.status,
    equivalence.created_by,
    equivalence.clinical_notes,
    equivalence.approved_by,
    equivalence.approved_at,
    equivalence.effective_from
  from public.medicine_equivalences equivalence
  where (
      equivalence.source_medicine_id = target_source_medicine_id
      or equivalence.equivalent_medicine_id = target_source_medicine_id
    )
    and case
      when equivalence.source_medicine_id = target_source_medicine_id
        then target_medicine_id
      else equivalence.source_medicine_id
    end <> case
      when equivalence.equivalent_medicine_id = target_source_medicine_id
        then target_medicine_id
      else equivalence.equivalent_medicine_id
    end
  on conflict (source_medicine_id, equivalent_medicine_id, kind) do nothing;

  update public.medicine_equivalences
  set status = 'retired',
      deleted_at = now()
  where source_medicine_id = target_source_medicine_id
     or equivalent_medicine_id = target_source_medicine_id;

  update public.medicines
  set status = 'retired',
      merged_into_id = target_medicine_id,
      deleted_at = now()
  where id = target_source_medicine_id
  returning catalog_version into source_version;

  update public.medicines
  set updated_at = now()
  where id = target_medicine_id
  returning catalog_version into resulting_version;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    'medicine.catalog-merged.v1',
    'medicine',
    target_medicine_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'sourceMedicineId', target_source_medicine_id,
      'targetMedicineId', target_medicine_id,
      'sourceVersion', source_version,
      'targetVersion', resulting_version,
      'contentSha256', content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':merged'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'medicine.catalog',
    'user',
    auth.uid()::text,
    'medicine',
    target_medicine_id::text,
    'catalog.merge',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-merged',
    'web',
    jsonb_build_object(
      'sourceMedicineId', target_source_medicine_id,
      'targetMedicineId', target_medicine_id,
      'sourceVersion', source_version,
      'targetVersion', resulting_version,
      'contentSha256', content_hash
    )
  );

  return jsonb_build_object(
    'sourceMedicineId', target_source_medicine_id,
    'targetMedicineId', target_medicine_id,
    'sourceVersion', source_version,
    'targetVersion', resulting_version,
    'contentSha256', content_hash
  );
end;
$$;

revoke all on function public.merge_catalog_medicines(
  uuid, uuid, uuid, integer, integer, text, text, text, text
) from public;
grant execute on function public.merge_catalog_medicines(
  uuid, uuid, uuid, integer, integer, text, text, text, text
) to authenticated;
