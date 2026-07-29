-- Wave 2.5: ranked medicine catalog search.

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
  with candidates as (
    select
      medicine.id as entity_id,
      'brand'::text as entity_type,
      greatest(
        similarity(lower(medicine.brand_name), lower(search_term)),
        similarity(lower(coalesce(medicine.manufacturer_name, '')), lower(search_term))
      )::double precision as relevance,
      case
        when similarity(lower(medicine.brand_name), lower(search_term))
          >= similarity(lower(coalesce(medicine.manufacturer_name, '')), lower(search_term))
        then 'name' else 'manufacturer'
      end::text as matched_on
    from public.medicines medicine
    where 'brand' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        medicine.brand_name % search_term
        or coalesce(medicine.manufacturer_name, '') % search_term
        or medicine.brand_name ilike '%' || search_term || '%'
      )
    union all
    select
      medicine.id,
      'generic'::text,
      similarity(lower(medicine.generic_name), lower(search_term))::double precision,
      'name'::text
    from public.medicines medicine
    where 'generic' = any(requested_types)
      and medicine.status = 'active'
      and medicine.deleted_at is null
      and (
        medicine.generic_name % search_term
        or medicine.generic_name ilike '%' || search_term || '%'
      )
  )
  select *
  from candidates
  order by relevance desc, entity_type, entity_id
  limit greatest(1, least(result_limit, 101))
  offset greatest(0, result_offset);
$$;

revoke all on function public.search_medicines(text, text[], integer, integer)
  from public;
grant execute on function public.search_medicines(text, text[], integer, integer)
  to authenticated;
