-- Make the existing tenant-scoped agent_escalations read policy reachable.
-- RLS continues to restrict authenticated reads to pharmacist/admin roles;
-- service_role is used by governed certification and operational tooling.

grant select on public.agent_escalations to authenticated, service_role;
