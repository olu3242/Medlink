-- Complete the deterministic browser fixture with the canonical fields the
-- production medicine search mapper requires. Kept separate from migration
-- 041 so already-applied migration history remains immutable.
create or replace function public.certify_golden_loop_search_projection(
  target_medicine_id uuid,
  fixture_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ingredient_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role'
     or fixture_key !~ '^[a-z0-9-]{6,80}$'
     or not exists (
       select 1 from public.medicines medicine
       where medicine.id = target_medicine_id
         and medicine.brand_name = 'Golden Loop Medicine ' || fixture_key
         and medicine.status = 'active'::public.medicine_record_status
         and medicine.deleted_at is null
     )
  then
    raise exception 'invalid golden-loop search fixture context'
      using errcode = '42501';
  end if;

  update public.medicines
  set manufacturer_name = 'MedLink Golden Loop Manufacturer'
  where id = target_medicine_id;

  insert into public.active_ingredients(id, preferred_name)
  values (ingredient_id, 'golden-loop-ingredient-' || fixture_key);

  insert into public.medicine_ingredients(
    medicine_id, active_ingredient_id, amount, unit, is_primary
  ) values (target_medicine_id, ingredient_id, 500, 'mg', true);
end;
$$;

revoke all on function public.certify_golden_loop_search_projection(uuid, text)
  from public, anon, authenticated;
grant execute on function public.certify_golden_loop_search_projection(uuid, text)
  to service_role;
