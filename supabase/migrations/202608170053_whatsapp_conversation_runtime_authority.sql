-- The inbound WhatsApp runtime uses a service-role client because provider
-- callbacks have no Supabase user session. Grant only the relations and
-- operations its existing adapters execute; human roles retain their RLS.
grant select on public.conversation_channel_bindings to service_role;
grant select, insert, update on public.conversations to service_role;
grant select, insert on public.conversation_messages to service_role;
grant select, insert on public.conversation_events to service_role;
grant select, insert, update on public.workflow_instances to service_role;

-- Medicine search is the only executable inbound workflow. The RPC remains
-- the bounded search projection; these reads only hydrate IDs it returned.
grant execute on function public.search_medicines(
  text, text[], integer, integer
) to service_role;
grant select on public.generics to service_role;

-- Deterministic certification authority for a verified channel identity.
-- It provisions no conversation, message, workflow, or domain state: those
-- must still be created through the signed production webhook.
create or replace function public.certify_whatsapp_golden_loop_identity(
  target_organization_id uuid,
  target_patient_id uuid,
  target_verified_by uuid,
  target_phone_number_id text,
  target_channel_identity text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     or nullif(btrim(target_phone_number_id), '') is null
     or nullif(btrim(target_channel_identity), '') is null
     or not exists (
       select 1 from public.organization_memberships membership
       where membership.organization_id = target_organization_id
         and membership.user_id = target_patient_id
         and membership.role = 'patient'::public.member_role
         and membership.deleted_at is null
     )
     or not exists (
       select 1 from public.organization_memberships membership
       where membership.organization_id = target_organization_id
         and membership.user_id = target_verified_by
         and membership.role = 'pharmacist'::public.member_role
         and membership.deleted_at is null
     )
  then
    raise exception 'invalid WhatsApp golden-loop identity context'
      using errcode = '42501';
  end if;

  insert into public.conversation_channel_bindings(
    organization_id, channel, channel_identifier
  ) values (
    target_organization_id, 'whatsapp', target_phone_number_id
  );

  insert into public.channel_identity_links(
    organization_id, channel, channel_identity, user_id, status,
    verified_at, verified_by
  ) values (
    target_organization_id, 'whatsapp', target_channel_identity,
    target_patient_id, 'verified', now(), target_verified_by
  );
end;
$$;

revoke all on function public.certify_whatsapp_golden_loop_identity(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.certify_whatsapp_golden_loop_identity(
  uuid, uuid, uuid, text, text
) to service_role;
