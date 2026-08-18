-- RC1 hardening: source prescriptions are clinical documents, not fulfillment data.
-- Patients may read their own object and pharmacists/admins may review it;
-- pharmacy fulfillment roles remain restricted to approved medication records.

drop policy if exists prescription_files_tenant_read
  on public.prescription_files;

create policy prescription_files_tenant_read
  on public.prescription_files for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      exists (
        select 1 from public.prescriptions p
        where p.id = prescription_id and p.patient_id = auth.uid()
      )
      or public.has_organization_role(
        organization_id,
        array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
      )
    )
  );

drop policy if exists prescription_objects_read
  on storage.objects;

create policy prescription_objects_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'prescriptions-private'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.has_organization_role(
        ((storage.foldername(name))[1])::uuid,
        array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
      )
    )
  );
