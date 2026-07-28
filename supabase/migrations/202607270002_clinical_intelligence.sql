-- Wave 2: Clinical Intelligence
-- Global medicine knowledge is shared across tenants. Prescriptions, extraction
-- results, equivalency reviews, and clinical validation are tenant isolated.

create extension if not exists pg_trgm;

create type public.medicine_record_status as enum (
  'draft', 'active', 'retired'
);

create type public.equivalence_kind as enum (
  'pharmaceutical', 'therapeutic'
);

create type public.review_status as enum (
  'pending', 'approved', 'rejected', 'needs_information'
);

create type public.prescription_source as enum (
  'upload', 'electronic', 'manual'
);

create type public.prescription_status as enum (
  'received', 'extracting', 'needs_review', 'validated', 'rejected'
);

create type public.extraction_status as enum (
  'queued', 'processing', 'completed', 'failed'
);

create type public.clinical_finding_kind as enum (
  'allergy', 'interaction', 'duplicate_therapy', 'dose', 'controlled_substance',
  'illegible', 'other'
);

create type public.clinical_severity as enum (
  'informational', 'low', 'moderate', 'high', 'critical'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = auth.uid()
      and membership.role = 'platform_admin'::public.member_role
      and membership.deleted_at is null
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

create table public.therapeutic_classes (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.therapeutic_classes(id),
  code text unique,
  name text not null unique check (char_length(name) between 2 and 200),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (parent_id is null or parent_id <> id)
);

create table public.active_ingredients (
  id uuid primary key default gen_random_uuid(),
  preferred_name text not null unique check (char_length(preferred_name) between 2 and 200),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null check (char_length(brand_name) between 2 and 200),
  generic_name text not null check (char_length(generic_name) between 2 and 300),
  therapeutic_class_id uuid references public.therapeutic_classes(id),
  dosage_form text not null check (char_length(dosage_form) between 2 and 100),
  route text not null check (char_length(route) between 2 and 100),
  strength_display text not null check (char_length(strength_display) between 1 and 100),
  pack_size text,
  manufacturer_name text,
  pregnancy_category text,
  controlled_substance boolean not null default false,
  storage_conditions text,
  image_url text,
  barcode text,
  status public.medicine_record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index medicines_barcode_unique_idx
  on public.medicines(barcode)
  where barcode is not null and deleted_at is null;
create index medicines_brand_trgm_idx
  on public.medicines using gin (brand_name gin_trgm_ops)
  where deleted_at is null;
create index medicines_generic_trgm_idx
  on public.medicines using gin (generic_name gin_trgm_ops)
  where deleted_at is null;
create index medicines_class_idx
  on public.medicines(therapeutic_class_id)
  where deleted_at is null;

create table public.medicine_ingredients (
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  active_ingredient_id uuid not null references public.active_ingredients(id),
  amount numeric(14, 6) check (amount is null or amount > 0),
  unit text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (medicine_id, active_ingredient_id)
);

create index medicine_ingredients_ingredient_idx
  on public.medicine_ingredients(active_ingredient_id, medicine_id);

create table public.medicine_aliases (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  alias text not null check (char_length(alias) between 2 and 300),
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  unique (medicine_id, alias, locale)
);

create index medicine_aliases_alias_trgm_idx
  on public.medicine_aliases using gin (alias gin_trgm_ops);

create table public.medicine_registrations (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  authority_code text not null check (char_length(authority_code) between 2 and 40),
  registration_number text not null,
  valid_from date,
  valid_until date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (country_code, authority_code, registration_number),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index medicine_registrations_medicine_idx
  on public.medicine_registrations(medicine_id)
  where deleted_at is null;

create table public.medicine_equivalences (
  id uuid primary key default gen_random_uuid(),
  source_medicine_id uuid not null references public.medicines(id),
  equivalent_medicine_id uuid not null references public.medicines(id),
  kind public.equivalence_kind not null,
  rationale text not null check (char_length(rationale) between 3 and 2000),
  evidence jsonb not null default '[]'::jsonb,
  requires_pharmacist_review boolean not null default true
    check (requires_pharmacist_review),
  status public.medicine_record_status not null default 'draft',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (source_medicine_id <> equivalent_medicine_id),
  unique (source_medicine_id, equivalent_medicine_id, kind)
);

create index medicine_equivalences_source_idx
  on public.medicine_equivalences(source_medicine_id)
  where deleted_at is null and status = 'active';
create index medicine_equivalences_target_idx
  on public.medicine_equivalences(equivalent_medicine_id)
  where deleted_at is null and status = 'active';

create table public.tenant_equivalence_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  equivalence_id uuid not null references public.medicine_equivalences(id),
  status public.review_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, equivalence_id),
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index tenant_equivalence_reviews_org_status_idx
  on public.tenant_equivalence_reviews(organization_id, status)
  where deleted_at is null;

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  patient_id uuid not null references auth.users(id),
  source public.prescription_source not null,
  status public.prescription_status not null default 'received',
  storage_bucket text,
  storage_object_path text,
  external_reference text,
  prescribed_at timestamptz,
  expires_at timestamptz,
  uploaded_by uuid not null references auth.users(id),
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    source <> 'upload'
    or (storage_bucket is not null and storage_object_path is not null)
  ),
  check (expires_at is null or prescribed_at is null or expires_at >= prescribed_at),
  check (
    (status = 'validated' and validated_by is not null and validated_at is not null)
    or status <> 'validated'
  ),
  unique (id, organization_id)
);

create index prescriptions_org_status_idx
  on public.prescriptions(organization_id, status, created_at desc)
  where deleted_at is null;
create index prescriptions_patient_idx
  on public.prescriptions(patient_id, created_at desc)
  where deleted_at is null;

create table public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null,
  line_number integer not null check (line_number > 0),
  medicine_id uuid references public.medicines(id),
  raw_medicine_text text not null,
  strength text,
  dosage text,
  route text,
  frequency text,
  duration text,
  quantity numeric(14, 3) check (quantity is null or quantity > 0),
  quantity_unit text,
  refills integer check (refills is null or refills >= 0),
  prescriber_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prescription_id, line_number)
);

create index prescription_items_medicine_idx
  on public.prescription_items(medicine_id)
  where medicine_id is not null;

create table public.prescription_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  status public.extraction_status not null default 'queued',
  provider text,
  model text,
  correlation_id text,
  raw_output jsonb,
  overall_confidence numeric(5, 4)
    check (overall_confidence between 0 and 1),
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete cascade
);

create index prescription_extractions_prescription_idx
  on public.prescription_extractions(prescription_id, created_at desc);
create index prescription_extractions_org_status_idx
  on public.prescription_extractions(organization_id, status, created_at)
  where status in ('queued', 'processing');

create table public.prescription_extracted_fields (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.prescription_extractions(id) on delete cascade,
  field_path text not null,
  raw_value text,
  normalized_value jsonb,
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  needs_human_review boolean not null,
  corrected_value jsonb,
  corrected_by uuid references auth.users(id),
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (extraction_id, field_path),
  check (
    (corrected_value is null and corrected_by is null and corrected_at is null)
    or
    (corrected_value is not null and corrected_by is not null and corrected_at is not null)
  )
);

create index prescription_extracted_fields_review_idx
  on public.prescription_extracted_fields(extraction_id)
  where needs_human_review;

create table public.clinical_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  prescription_id uuid not null,
  status public.review_status not null default 'pending',
  summary text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  pharmacist_acknowledged_high_risk_at timestamptz,
  correlation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  ),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete cascade
);

create index clinical_validations_org_queue_idx
  on public.clinical_validations(organization_id, status, created_at);
create index clinical_validations_prescription_idx
  on public.clinical_validations(prescription_id, created_at desc);

create table public.clinical_findings (
  id uuid primary key default gen_random_uuid(),
  validation_id uuid not null references public.clinical_validations(id) on delete cascade,
  prescription_item_id uuid references public.prescription_items(id) on delete cascade,
  kind public.clinical_finding_kind not null,
  severity public.clinical_severity not null,
  title text not null,
  detail text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(5, 4) check (confidence between 0 and 1),
  requires_acknowledgement boolean not null default false,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (acknowledged_by is null and acknowledged_at is null)
    or (acknowledged_by is not null and acknowledged_at is not null)
  ),
  check (
    severity not in ('high', 'critical') or requires_acknowledgement
  )
);

create index clinical_findings_validation_idx
  on public.clinical_findings(validation_id, severity);
create index clinical_findings_unacknowledged_idx
  on public.clinical_findings(validation_id)
  where requires_acknowledgement and acknowledged_at is null;

create trigger therapeutic_classes_set_updated_at
before update on public.therapeutic_classes
for each row execute function public.set_updated_at();
create trigger active_ingredients_set_updated_at
before update on public.active_ingredients
for each row execute function public.set_updated_at();
create trigger medicines_set_updated_at
before update on public.medicines
for each row execute function public.set_updated_at();
create trigger medicine_registrations_set_updated_at
before update on public.medicine_registrations
for each row execute function public.set_updated_at();
create trigger medicine_equivalences_set_updated_at
before update on public.medicine_equivalences
for each row execute function public.set_updated_at();
create trigger tenant_equivalence_reviews_set_updated_at
before update on public.tenant_equivalence_reviews
for each row execute function public.set_updated_at();
create trigger prescriptions_set_updated_at
before update on public.prescriptions
for each row execute function public.set_updated_at();
create trigger prescription_items_set_updated_at
before update on public.prescription_items
for each row execute function public.set_updated_at();
create trigger prescription_extractions_set_updated_at
before update on public.prescription_extractions
for each row execute function public.set_updated_at();
create trigger clinical_validations_set_updated_at
before update on public.clinical_validations
for each row execute function public.set_updated_at();

alter table public.therapeutic_classes enable row level security;
alter table public.active_ingredients enable row level security;
alter table public.medicines enable row level security;
alter table public.medicine_ingredients enable row level security;
alter table public.medicine_aliases enable row level security;
alter table public.medicine_registrations enable row level security;
alter table public.medicine_equivalences enable row level security;
alter table public.tenant_equivalence_reviews enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_items enable row level security;
alter table public.prescription_extractions enable row level security;
alter table public.prescription_extracted_fields enable row level security;
alter table public.clinical_validations enable row level security;
alter table public.clinical_findings enable row level security;

create policy therapeutic_classes_read
  on public.therapeutic_classes for select to authenticated
  using (deleted_at is null);
create policy active_ingredients_read
  on public.active_ingredients for select to authenticated
  using (deleted_at is null);
create policy medicines_read
  on public.medicines for select to authenticated
  using (deleted_at is null and status = 'active');
create policy medicine_ingredients_read
  on public.medicine_ingredients for select to authenticated
  using (exists (
    select 1 from public.medicines medicine
    where medicine.id = medicine_id
      and medicine.deleted_at is null
      and medicine.status = 'active'
  ));
create policy medicine_aliases_read
  on public.medicine_aliases for select to authenticated
  using (exists (
    select 1 from public.medicines medicine
    where medicine.id = medicine_id
      and medicine.deleted_at is null
      and medicine.status = 'active'
  ));
create policy medicine_registrations_read
  on public.medicine_registrations for select to authenticated
  using (deleted_at is null);
create policy medicine_equivalences_read
  on public.medicine_equivalences for select to authenticated
  using (deleted_at is null and status = 'active');

create policy therapeutic_classes_admin
  on public.therapeutic_classes for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy active_ingredients_admin
  on public.active_ingredients for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy medicines_admin
  on public.medicines for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy medicine_ingredients_admin
  on public.medicine_ingredients for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy medicine_aliases_admin
  on public.medicine_aliases for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy medicine_registrations_admin
  on public.medicine_registrations for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy medicine_equivalences_admin
  on public.medicine_equivalences for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy tenant_equivalence_reviews_member_read
  on public.tenant_equivalence_reviews for select to authenticated
  using (public.is_organization_member(organization_id));
create policy tenant_equivalence_reviews_pharmacist_manage
  on public.tenant_equivalence_reviews for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['pharmacist']::public.member_role[]
  ))
  with check (
    public.has_organization_role(
      organization_id,
      array['pharmacist']::public.member_role[]
    )
    and (status = 'pending' or reviewed_by = auth.uid())
  );

create policy prescriptions_read
  on public.prescriptions for select to authenticated
  using (
    patient_id = auth.uid()
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
            'pharmacy_staff']::public.member_role[]
    )
  );
create policy prescriptions_create
  on public.prescriptions for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.is_organization_member(organization_id)
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id,
        array['platform_admin', 'tenant_admin', 'pharmacist',
              'pharmacy_staff']::public.member_role[]
      )
    )
  );
create policy prescriptions_clinical_update
  on public.prescriptions for update to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
  ));

create policy prescription_items_read
  on public.prescription_items for select to authenticated
  using (exists (
    select 1 from public.prescriptions prescription
    where prescription.id = prescription_id
      and prescription.deleted_at is null
      and (
        prescription.patient_id = auth.uid()
        or public.has_organization_role(
          prescription.organization_id,
          array['platform_admin', 'tenant_admin', 'pharmacist',
                'pharmacy_owner', 'pharmacy_staff']::public.member_role[]
        )
      )
  ));
create policy prescription_items_clinical_manage
  on public.prescription_items for all to authenticated
  using (exists (
    select 1 from public.prescriptions prescription
    where prescription.id = prescription_id
      and public.has_organization_role(
        prescription.organization_id,
        array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
      )
  ))
  with check (exists (
    select 1 from public.prescriptions prescription
    where prescription.id = prescription_id
      and public.has_organization_role(
        prescription.organization_id,
        array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
      )
  ));

create policy prescription_extractions_clinical_read
  on public.prescription_extractions for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
  ));
create policy prescription_extractions_clinical_manage
  on public.prescription_extractions for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
  ));

create policy prescription_extracted_fields_clinical
  on public.prescription_extracted_fields for all to authenticated
  using (exists (
    select 1 from public.prescription_extractions extraction
    where extraction.id = extraction_id
      and public.has_organization_role(
        extraction.organization_id,
        array['pharmacist']::public.member_role[]
      )
  ))
  with check (exists (
    select 1 from public.prescription_extractions extraction
    where extraction.id = extraction_id
      and public.has_organization_role(
        extraction.organization_id,
        array['pharmacist']::public.member_role[]
      )
  ));

create policy clinical_validations_clinical
  on public.clinical_validations for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['pharmacist']::public.member_role[]
  ))
  with check (
    public.has_organization_role(
      organization_id,
      array['pharmacist']::public.member_role[]
    )
    and (status = 'pending' or reviewed_by = auth.uid())
  );
create policy clinical_findings_clinical
  on public.clinical_findings for all to authenticated
  using (exists (
    select 1 from public.clinical_validations validation
    where validation.id = validation_id
      and public.has_organization_role(
        validation.organization_id,
        array['pharmacist']::public.member_role[]
      )
  ))
  with check (exists (
    select 1 from public.clinical_validations validation
    where validation.id = validation_id
      and public.has_organization_role(
        validation.organization_id,
        array['pharmacist']::public.member_role[]
      )
  ));

comment on table public.prescriptions is
  'Contains PHI/PII: patient identity, prescriber context, and private storage references. Tenant and patient access is restricted by RLS.';
comment on column public.prescriptions.storage_object_path is
  'PHI-bearing private object reference. The referenced bucket must not be public and requires equivalent authorization.';
comment on table public.prescription_items is
  'Contains PHI: prescribed medicines, dosage, quantity, refills, and prescriber instructions.';
comment on table public.prescription_extractions is
  'Contains PHI: OCR/model output derived from a prescription. Raw output must not be written to application logs.';
comment on table public.prescription_extracted_fields is
  'Contains PHI and human corrections. Retained for auditable extraction review.';
comment on table public.clinical_validations is
  'Contains PHI and clinical decision-support review metadata; recommendations never constitute an autonomous clinical decision.';
comment on table public.clinical_findings is
  'Contains PHI: allergy, interaction, dose, and other patient-specific clinical risk findings.';
comment on table public.tenant_equivalence_reviews is
  'Tenant pharmacist review of a global equivalence candidate. Approval is required before substitution may be presented as reviewed.';
