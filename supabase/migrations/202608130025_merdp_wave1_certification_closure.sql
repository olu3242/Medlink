-- Reproducible Wave 1 certification orchestration. This composes existing
-- domain commands; it does not grant MERDP ownership of clinical or inventory.
create or replace function public.certify_merdp_wave1_golden_lineage(
  patient_id uuid, pharmacist_id uuid, inventory_actor_id uuid, fixture_key text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  source_row record;
  publication_row record;
  medicine_row record;
  mapping_row record;
  certification_row record;
  organization_id uuid := gen_random_uuid();
  location_id uuid := gen_random_uuid();
  prescription_result jsonb;
  prescription_item_row record;
  validation_row record;
  review_result jsonb;
  review_item_row record;
  inventory_result jsonb;
  inventory_row record;
  finding_ids uuid[];
  unauthorized_denied boolean := false;
  runtime_found boolean;
  unpublished_excluded boolean;
  quarantine_excluded boolean;
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode='42501';
  end if;

  select p.* into strict publication_row from public.merdp_publications p
  order by p.canonical_product_id,p.version limit 1;
  select m.* into strict medicine_row from public.medicines m
  where m.id=publication_row.canonical_product_id and m.status='active';
  select m.* into strict mapping_row from public.merdp_source_mappings m
  where m.canonical_product_id=medicine_row.id;
  select r.* into strict source_row from public.etl_source_records r
  where r.id=mapping_row.source_record_id;
  select c.* into strict certification_row from public.merdp_certifications c
  where c.id=publication_row.certification_id and c.status='certified';

  insert into public.organizations(id,name,slug,type)
  values(organization_id,'Wave 1 Certification '||fixture_key,'wave1-cert-'||fixture_key,'pharmacy');
  insert into public.user_profiles(id,display_name) values
    (patient_id,'Wave 1 Patient'),(pharmacist_id,'Wave 1 Pharmacist'),
    (inventory_actor_id,'Wave 1 Inventory');
  insert into public.organization_memberships(organization_id,user_id,role) values
    (organization_id,patient_id,'patient'),(organization_id,pharmacist_id,'pharmacist'),
    (organization_id,inventory_actor_id,'inventory_manager');
  insert into public.pharmacist_profiles(
    organization_id,user_id,license_number,issuing_authority,
    verification_status,is_active,license_expires_on,verified_by,verified_at
  ) values(organization_id,pharmacist_id,'PCN-'||fixture_key,'PCN','verified',true,
    '2099-12-31',pharmacist_id,now());
  insert into public.pharmacy_locations(
    id,organization_id,name,address_line_1,locality,country_code,latitude,longitude
  ) values(location_id,organization_id,'Wave 1 Pharmacy','1 Certification Way',
    'Lagos','NG',6.5244,3.3792);

  perform set_config('request.jwt.claim.sub',patient_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select exists(select 1 from public.search_medicines(
    medicine_row.brand_name,array['brand','generic']::text[],20,0) s
    where s.entity_id=medicine_row.id) into runtime_found;
  prescription_result:=public.create_manual_prescription(
    organization_id,patient_id,
    jsonb_build_array(jsonb_build_object('medicineId',medicine_row.id,
      'strength',medicine_row.strength_display,'dosage','One tablet daily')),
    'Wave 1 Prescriber','MedLink Certification','Golden lineage',now(),
    '2099-12-31',true,'wave1-rx-'||fixture_key,'wave1-'||fixture_key,'wave1-'||fixture_key);
  select i.* into strict prescription_item_row from public.prescription_items i
  where i.prescription_id=(prescription_result->>'prescriptionId')::uuid;
  begin
    perform public.decide_prescription_validation_with_resolution(
      organization_id,(prescription_result->>'reviewId')::uuid,'approved',
      'Unauthorized attempt',array[]::uuid[],
      jsonb_build_array(jsonb_build_object('prescriptionItemId',prescription_item_row.id,
        'medicineId',medicine_row.id)),
      'wave1-denied-'||fixture_key,'wave1-'||fixture_key,'wave1-'||fixture_key);
  exception when insufficient_privilege then unauthorized_denied:=true;
  end;

  perform set_config('request.jwt.claim.sub',pharmacist_id::text,true);
  select coalesce(array_agg(f.id),array[]::uuid[]) into finding_ids
  from public.clinical_findings f
  where f.validation_id=(prescription_result->>'reviewId')::uuid;
  review_result:=public.decide_prescription_validation_with_resolution(
    organization_id,(prescription_result->>'reviewId')::uuid,'approved',
    'Canonical identity verified',finding_ids,
    jsonb_build_array(jsonb_build_object('prescriptionItemId',prescription_item_row.id,
      'medicineId',medicine_row.id)),
    'wave1-review-'||fixture_key,'wave1-'||fixture_key,'wave1-'||fixture_key);
  select v.* into strict validation_row from public.clinical_validations v
  where v.id=(prescription_result->>'reviewId')::uuid;
  select i.* into strict review_item_row from public.clinical_review_items i
  where i.validation_id=validation_row.id;

  perform set_config('request.jwt.claim.sub',inventory_actor_id::text,true);
  inventory_result:=public.create_inventory_batch(organization_id,
    jsonb_build_object('pharmacyLocationId',location_id,'medicineId',medicine_row.id,
      'batchNumber','WAVE1-'||fixture_key,'expiresOn','2099-12-31','quantity',25,
      'unit','tablet','lowStockThreshold',5),
    'wave1-inventory-'||fixture_key,'wave1-'||fixture_key,'wave1-'||fixture_key);
  select b.* into strict inventory_row from public.inventory_batches b
  where b.id=(inventory_result->>'inventoryId')::uuid;

  select not exists(select 1 from public.search_medicines(
    draft.brand_name,array['brand','generic']::text[],100,0) s where s.entity_id=draft.id)
  into unpublished_excluded from public.medicines draft
  where draft.status='draft' order by draft.id limit 1;
  select not exists(select 1 from public.merdp_source_mappings m
    where m.source_record_id=f.source_record_id) into quarantine_excluded
  from public.merdp_quality_findings f where f.severity in ('quarantine','reject')
  order by f.id limit 1;

  if not runtime_found or not unauthorized_denied or not unpublished_excluded
     or not quarantine_excluded
     or prescription_item_row.medicine_id<>medicine_row.id
     or review_item_row.medicine_id<>medicine_row.id
     or inventory_row.medicine_id<>medicine_row.id
     or source_row.source_record_id=medicine_row.id::text
     or mapping_row.id::text=medicine_row.id::text
     or mapping_row.regulatory_identifier=medicine_row.id::text then
    raise exception 'golden lineage certification assertion failed: %',jsonb_build_object(
      'runtimeFound',runtime_found,'unauthorizedDenied',unauthorized_denied,
      'unpublishedExcluded',unpublished_excluded,'quarantineExcluded',quarantine_excluded,
      'prescriptionMedicine',prescription_item_row.medicine_id,
      'pharmacistMedicine',review_item_row.medicine_id,
      'inventoryMedicine',inventory_row.medicine_id,'canonicalMedicine',medicine_row.id);
  end if;

  return jsonb_build_object(
    'sourceSnapshotId',source_row.snapshot_id,'rawSourceRecordId',source_row.id,
    'greenbookProductId',source_row.source_record_id,
    'nrn',mapping_row.regulatory_identifier,'canonicalMedicineId',medicine_row.id,
    'sourceMappingId',mapping_row.id,
    'provenanceIds',(select jsonb_agg(p.id order by p.id) from public.merdp_provenance p
      where p.canonical_product_id=medicine_row.id),
    'provenanceCount',(select count(*) from public.merdp_provenance p
      where p.canonical_product_id=medicine_row.id),
    'certificationId',certification_row.id,'publicationId',publication_row.id,
    'publicationVersion',publication_row.version,'runtimeMedicineId',medicine_row.id,
    'prescriptionId',prescription_result->>'prescriptionId',
    'prescriptionMedicineId',prescription_item_row.medicine_id,
    'pharmacistWorkflowId',validation_row.workflow_run_id,
    'pharmacistReviewId',validation_row.id,'pharmacistMedicineId',review_item_row.medicine_id,
    'inventoryReferenceId',inventory_row.id,'inventoryMedicineId',inventory_row.medicine_id,
    'canonicalIdentityContinuity',true,'rawIdentityLeakage',false,
    'unauthorizedPharmacistDenied',unauthorized_denied,
    'unpublishedRuntimeExcluded',unpublished_excluded,
    'quarantineExcluded',quarantine_excluded,'reviewResult',review_result);
end;
$$;
revoke all on function public.certify_merdp_wave1_golden_lineage(uuid,uuid,uuid,text) from public;
grant execute on function public.certify_merdp_wave1_golden_lineage(uuid,uuid,uuid,text) to service_role;
