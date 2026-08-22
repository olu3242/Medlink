-- Keep the fixed Conversation Runtime actor readable by Supabase Auth.
--
-- Migration 202608010001 intentionally created this actor without a login
-- identity or usable password. It omitted several legacy token/change columns,
-- however, and auth.users permits those columns to be null. GoTrue v2.195.0
-- scans them into non-nullable strings when listing users, so the single null
-- row makes the Admin users endpoint fail with "Database error finding users".
--
-- This repair is deliberately limited to the documented ADR 0004 system UUID.
-- It does not create an identity, password, session, membership, or permission.

do $$
declare
  target_count integer;
begin
  select count(*)
  into target_count
  from auth.users
  where id = '11111111-1111-4111-8111-111111111111'
    and instance_id = '00000000-0000-0000-0000-000000000000'
    and email = 'whatsapp-webhook@system.medlink.internal'
    and encrypted_password = ''
    and raw_app_meta_data ->> 'provider' = 'system'
    and raw_app_meta_data -> 'providers' = '["system"]'::jsonb;

  if target_count <> 1 then
    raise exception
      'Expected exactly one governed Conversation Runtime system identity, found %',
      target_count;
  end if;

  update auth.users
  set confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      email_change_token_new = coalesce(email_change_token_new, ''),
      email_change = coalesce(email_change, ''),
      phone_change_token = coalesce(phone_change_token, ''),
      phone_change = coalesce(phone_change, ''),
      reauthentication_token = coalesce(reauthentication_token, '')
  where id = '11111111-1111-4111-8111-111111111111';

  if exists (
    select 1
    from auth.users
    where id = '11111111-1111-4111-8111-111111111111'
      and (
        confirmation_token is null
        or recovery_token is null
        or email_change_token_current is null
        or email_change_token_new is null
        or email_change is null
        or phone_change_token is null
        or phone_change is null
        or reauthentication_token is null
      )
  ) then
    raise exception 'Conversation Runtime system identity remains Auth-incompatible';
  end if;
end
$$;
