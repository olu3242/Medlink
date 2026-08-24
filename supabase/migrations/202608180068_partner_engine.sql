-- Partner Engine: governed applicant-to-active lifecycle converged on the
-- canonical organization, workflow, audit, outbox, pharmacy, and MERDP models.

create type public.partner_type as enum (
  'pharmacy','pharmacy_chain','manufacturer','distributor','wholesaler',
  'healthcare_provider','hospital_clinic','payer_insurer','logistics',
  'technology_api','government_regulator','other'
);
create type public.partner_relationship_status as enum (
  'prospect','applicant','under_review','needs_information','approved','active',
  'suspended','inactive','terminated','rejected'
);
create type public.partner_onboarding_stage as enum (
  'application','identity','qualification','compliance','agreement',
  'integration','activation','complete'
);
create type public.partner_integration_status as enum (
  'not_started','not_required','planning','testing','certified','suspended'
);
create type public.partner_requirement_status as enum (
  'pending','submitted','satisfied','waived','failed'
);
create type public.partner_verification_status as enum (
  'pending','verified','failed','expired'
);

insert into public.organizations(name, slug, type, branding)
values ('MedLink Partner Operations','medlink-partner-operations','technology',
  '{"system":true,"purpose":"partner-control-plane"}'::jsonb)
on conflict (slug) do nothing;

create table public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 200),
  trading_name text check (trading_name is null or char_length(btrim(trading_name)) between 2 and 200),
  partner_type public.partner_type not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  website text,
  summary text not null check (char_length(btrim(summary)) between 20 and 2000),
  relationship_status public.partner_relationship_status not null default 'applicant',
  onboarding_stage public.partner_onboarding_stage not null default 'application',
  integration_status public.partner_integration_status not null default 'not_started',
  version integer not null default 1 check (version > 0),
  public_reference text not null unique default ('PRT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  submitted_at timestamptz,
  approved_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index partner_applications_applicant_idx on public.partner_applications(applicant_user_id, updated_at desc) where deleted_at is null;
create index partner_applications_review_idx on public.partner_applications(relationship_status, onboarding_stage, updated_at) where deleted_at is null;
create index partner_applications_org_idx on public.partner_applications(organization_id) where organization_id is not null and deleted_at is null;

create table public.partner_contacts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  contact_kind text not null default 'primary' check (contact_kind in ('primary','legal','technical','billing','operations')),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text,
  title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(application_id, contact_kind, email)
);
create unique index partner_contacts_one_primary_idx on public.partner_contacts(application_id) where is_primary;

create table public.partner_identity_claims (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete restrict,
  scheme text not null check (char_length(btrim(scheme)) between 2 and 80),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  raw_value text not null check (char_length(btrim(raw_value)) between 2 and 160),
  normalized_value text not null check (char_length(btrim(normalized_value)) between 2 and 160),
  verification_status public.partner_verification_status not null default 'pending',
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scheme, country_code, normalized_value)
);

create table public.partner_qualifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  qualification_type text not null check (char_length(btrim(qualification_type)) between 2 and 100),
  issuer text,
  reference text,
  document_reference text,
  document_digest text check (document_digest is null or document_digest ~ '^[A-Fa-f0-9]{64}$'),
  expires_at date,
  status public.partner_verification_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(application_id, qualification_type, reference)
);

create table public.partner_verification_records (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  subject_type text not null check (subject_type in ('identity','qualification','compliance')),
  subject_id uuid,
  status public.partner_verification_status not null,
  reviewer_id uuid not null references auth.users(id),
  evidence_reference text,
  evidence_digest text check (evidence_digest is null or evidence_digest ~ '^[A-Fa-f0-9]{64}$'),
  notes text,
  created_at timestamptz not null default now()
);

create table public.partner_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approve','reject','request_information')),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 8 and 200),
  created_at timestamptz not null default now(),
  unique(application_id, idempotency_key)
);

create table public.partner_requirements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  requirement_code text not null check (requirement_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  required boolean not null default true,
  status public.partner_requirement_status not null default 'pending',
  evidence_reference text,
  satisfied_by uuid references auth.users(id),
  satisfied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(application_id, requirement_code)
);

create table public.partner_agreements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete restrict,
  agreement_type text not null default 'partner_terms',
  version text not null check (char_length(btrim(version)) between 1 and 80),
  document_reference text not null,
  document_digest text not null check (document_digest ~ '^[A-Fa-f0-9]{64}$'),
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  unique(application_id, agreement_type, version)
);

create table public.partner_integration_profiles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.partner_applications(id) on delete cascade,
  provider_kind text not null default 'none',
  contract_version text not null default 'partner-provider.v1',
  endpoint_origin text,
  capabilities text[] not null default '{}',
  status public.partner_integration_status not null default 'not_started',
  certified_by uuid references auth.users(id),
  certified_at timestamptz,
  health_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (endpoint_origin is null or endpoint_origin ~ '^https://')
);

create table public.partner_readiness_assessments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  assessed_by uuid not null references auth.users(id),
  ready boolean not null,
  blockers text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (evidence::text !~* '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:')
);

create table public.partner_status_history (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.partner_applications(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  previous_status public.partner_relationship_status,
  new_status public.partner_relationship_status not null,
  previous_stage public.partner_onboarding_stage,
  new_stage public.partner_onboarding_stage not null,
  reason text,
  correlation_id text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(application_id, idempotency_key)
);

create table public.partner_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete restrict,
  organization_id uuid not null references public.organizations(id),
  event_type text not null,
  actor_id uuid not null references auth.users(id),
  correlation_id text not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(application_id, idempotency_key),
  check (metadata::text !~* '"(password|secret|token|api_key|private_key|credential|email|phone)"[[:space:]]*:')
);

create trigger partner_applications_updated before update on public.partner_applications for each row execute function public.set_updated_at();
create trigger partner_contacts_updated before update on public.partner_contacts for each row execute function public.set_updated_at();
create trigger partner_identity_claims_updated before update on public.partner_identity_claims for each row execute function public.set_updated_at();
create trigger partner_qualifications_updated before update on public.partner_qualifications for each row execute function public.set_updated_at();
create trigger partner_requirements_updated before update on public.partner_requirements for each row execute function public.set_updated_at();
create trigger partner_integrations_updated before update on public.partner_integration_profiles for each row execute function public.set_updated_at();
create trigger partner_status_history_append_only before update or delete on public.partner_status_history for each row execute function public.prevent_enterprise_event_mutation();
create trigger partner_lifecycle_events_append_only before update or delete on public.partner_lifecycle_events for each row execute function public.prevent_enterprise_event_mutation();
create trigger partner_decisions_append_only before update or delete on public.partner_decisions for each row execute function public.prevent_enterprise_event_mutation();
create trigger partner_verifications_append_only before update or delete on public.partner_verification_records for each row execute function public.prevent_enterprise_event_mutation();

create or replace function public.can_access_partner_application(target_application_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.partner_applications a
    where a.id=target_application_id and a.deleted_at is null and (
      a.applicant_user_id=auth.uid() or public.is_platform_admin() or
      (a.organization_id is not null and public.is_organization_member(a.organization_id))
    )
  )
$$;
revoke all on function public.can_access_partner_application(uuid) from public;
grant execute on function public.can_access_partner_application(uuid) to authenticated;

create or replace function public.partner_control_organization_id()
returns uuid language sql stable security definer set search_path=''
as $$ select id from public.organizations where slug='medlink-partner-operations' and deleted_at is null $$;
revoke all on function public.partner_control_organization_id() from public;

create or replace function public.record_partner_event(
  target_application_id uuid, target_actor_id uuid, target_event_type text,
  target_previous_status public.partner_relationship_status,
  target_new_status public.partner_relationship_status,
  target_previous_stage public.partner_onboarding_stage,
  target_new_stage public.partner_onboarding_stage,
  target_reason text, target_correlation_id text, target_idempotency_key text
) returns void language plpgsql security definer set search_path=''
as $$
declare evidence_org uuid; target_org uuid;
begin
  select organization_id into target_org from public.partner_applications where id=target_application_id;
  evidence_org:=coalesce(target_org,public.partner_control_organization_id());
  insert into public.partner_status_history(application_id,actor_id,previous_status,new_status,previous_stage,new_stage,reason,correlation_id,idempotency_key)
  values(target_application_id,target_actor_id,target_previous_status,target_new_status,target_previous_stage,target_new_stage,target_reason,target_correlation_id,target_idempotency_key)
  on conflict(application_id,idempotency_key) do nothing;
  insert into public.partner_lifecycle_events(application_id,organization_id,event_type,actor_id,correlation_id,idempotency_key,metadata)
  values(target_application_id,evidence_org,target_event_type,target_actor_id,target_correlation_id,target_idempotency_key,
    jsonb_build_object('relationshipStatus',target_new_status,'onboardingStage',target_new_stage))
  on conflict(application_id,idempotency_key) do nothing;
  insert into public.runtime_outbox_events(organization_id,event_type,aggregate_type,aggregate_id,payload,correlation_id,request_id,workflow_id,idempotency_key)
  values(evidence_org,target_event_type,'partner_application',target_application_id::text,
    jsonb_build_object('applicationId',target_application_id,'relationshipStatus',target_new_status,'onboardingStage',target_new_stage),
    target_correlation_id,target_correlation_id,'WF-016','partner:'||target_application_id||':'||target_idempotency_key)
  on conflict(organization_id,idempotency_key) do nothing;
  insert into public.governance_audit_events(organization_id,event_type,actor_id,actor_type,resource_type,resource_id,action,outcome,reason,correlation_id,request_id,idempotency_key,previous_state,new_state,workflow_id,source_channel,metadata)
  values(evidence_org,'partner.lifecycle',target_actor_id,'user','partner_application',target_application_id::text,target_event_type,'success',target_reason,target_correlation_id,target_correlation_id,
    'partner:'||target_application_id||':'||target_idempotency_key||':audit',
    jsonb_build_object('relationshipStatus',target_previous_status,'onboardingStage',target_previous_stage),
    jsonb_build_object('relationshipStatus',target_new_status,'onboardingStage',target_new_stage),
    'WF-016','web',jsonb_build_object('partner_application_id',target_application_id))
  on conflict(organization_id,idempotency_key) do nothing;
end $$;
revoke all on function public.record_partner_event(uuid,uuid,text,public.partner_relationship_status,public.partner_relationship_status,public.partner_onboarding_stage,public.partner_onboarding_stage,text,text,text) from public;

create or replace function public.create_partner_application(
  target_legal_name text, target_trading_name text, target_partner_type public.partner_type,
  target_country_code text, target_website text, target_summary text,
  target_contact_name text, target_contact_email text, target_contact_phone text,
  target_contact_title text, target_identity_scheme text, target_identity_value text,
  target_idempotency_key text, target_correlation_id text
) returns public.partner_applications language plpgsql security definer set search_path=''
as $$
declare created public.partner_applications; control_org uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  select a.* into created from public.partner_applications a
    join public.partner_lifecycle_events e on e.application_id=a.id
    where a.applicant_user_id=auth.uid() and e.idempotency_key=target_idempotency_key;
  if found then return created; end if;
  insert into public.partner_applications(applicant_user_id,legal_name,trading_name,partner_type,country_code,website,summary)
  values(auth.uid(),btrim(target_legal_name),nullif(btrim(target_trading_name),''),target_partner_type,upper(target_country_code),nullif(btrim(target_website),''),btrim(target_summary)) returning * into created;
  insert into public.partner_contacts(application_id,name,email,phone,title,is_primary)
  values(created.id,btrim(target_contact_name),lower(btrim(target_contact_email)),nullif(btrim(target_contact_phone),''),nullif(btrim(target_contact_title),''),true);
  insert into public.partner_identity_claims(application_id,scheme,country_code,raw_value,normalized_value)
  values(created.id,lower(btrim(target_identity_scheme)),created.country_code,btrim(target_identity_value),upper(regexp_replace(btrim(target_identity_value),'[^a-zA-Z0-9]','','g')));
  control_org:=public.partner_control_organization_id();
  insert into public.workflow_instances(organization_id,type,status,idempotency_key,context)
  values(control_org,'WF-016','running','partner:'||created.id,jsonb_build_object('partnerApplicationId',created.id,'stage','application'));
  perform public.record_partner_event(created.id,auth.uid(),'partner.application.created.v1',null,created.relationship_status,null,created.onboarding_stage,null,target_correlation_id,target_idempotency_key);
  return created;
end $$;
revoke all on function public.create_partner_application(text,text,public.partner_type,text,text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_partner_application(text,text,public.partner_type,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.update_partner_application(
  target_application_id uuid,target_expected_version integer,target_trading_name text,
  target_website text,target_summary text,target_idempotency_key text,target_correlation_id text
) returns public.partner_applications language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; updated public.partner_applications;
begin
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id is distinct from auth.uid() then raise exception 'Application access denied'; end if;
  if exists(select 1 from public.partner_lifecycle_events where application_id=current.id and idempotency_key=target_idempotency_key) then return current; end if;
  if current.version<>target_expected_version then raise exception 'Stale application version'; end if;
  if current.relationship_status not in ('applicant','needs_information') then raise exception 'Only an editable application may be updated'; end if;
  update public.partner_applications set trading_name=nullif(btrim(target_trading_name),''),website=nullif(btrim(target_website),''),summary=btrim(target_summary),version=version+1
    where id=current.id returning * into updated;
  perform public.record_partner_event(current.id,auth.uid(),'partner.application.updated.v1',current.relationship_status,updated.relationship_status,current.onboarding_stage,updated.onboarding_stage,null,target_correlation_id,target_idempotency_key);
  return updated;
end $$;
revoke all on function public.update_partner_application(uuid,integer,text,text,text,text,text) from public;
grant execute on function public.update_partner_application(uuid,integer,text,text,text,text,text) to authenticated;

create or replace function public.add_partner_qualification(
  target_application_id uuid,target_qualification_type text,target_issuer text,
  target_reference text,target_document_reference text,target_document_digest text,
  target_expires_at date,target_idempotency_key text,target_correlation_id text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; qualification_id uuid;
begin
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id is distinct from auth.uid() then raise exception 'Application access denied'; end if;
  if current.relationship_status not in ('applicant','needs_information','under_review','approved') then raise exception 'Qualifications cannot be added in the current state'; end if;
  insert into public.partner_qualifications(application_id,qualification_type,issuer,reference,document_reference,document_digest,expires_at)
    values(current.id,target_qualification_type,target_issuer,target_reference,target_document_reference,target_document_digest,target_expires_at)
    on conflict(application_id,qualification_type,reference) do update set issuer=excluded.issuer,document_reference=excluded.document_reference,document_digest=excluded.document_digest,expires_at=excluded.expires_at
    returning id into qualification_id;
  perform public.record_partner_event(current.id,auth.uid(),'partner.qualification.submitted.v1',current.relationship_status,current.relationship_status,current.onboarding_stage,current.onboarding_stage,null,target_correlation_id,target_idempotency_key);
  return qualification_id;
end $$;
revoke all on function public.add_partner_qualification(uuid,text,text,text,text,text,date,text,text) from public;
grant execute on function public.add_partner_qualification(uuid,text,text,text,text,text,date,text,text) to authenticated;

create or replace function public.submit_partner_application(
  target_application_id uuid, target_expected_version integer,
  target_idempotency_key text, target_correlation_id text
) returns public.partner_applications language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; updated public.partner_applications;
begin
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id is distinct from auth.uid() then raise exception 'Application access denied'; end if;
  if exists(select 1 from public.partner_lifecycle_events where application_id=current.id and idempotency_key=target_idempotency_key) then return current; end if;
  if current.version<>target_expected_version then raise exception 'Stale application version'; end if;
  if current.relationship_status not in ('applicant','needs_information') then raise exception 'Application cannot be submitted from current status'; end if;
  if not exists(select 1 from public.partner_contacts where application_id=current.id and is_primary)
    or not exists(select 1 from public.partner_identity_claims where application_id=current.id) then raise exception 'Application identity and primary contact are required'; end if;
  update public.partner_applications set relationship_status='under_review',onboarding_stage='identity',submitted_at=coalesce(submitted_at,now()),version=version+1
    where id=current.id returning * into updated;
  insert into public.partner_requirements(application_id,requirement_code,title) values
    (current.id,'identity_verified','Legal identity verified'),
    (current.id,'compliance_verified','Compliance review completed'),
    (current.id,'agreement_accepted','Current partner agreement accepted'),
    (current.id,'integration_certified','Integration certified or formally not required')
    on conflict(application_id,requirement_code) do nothing;
  if current.partner_type in ('pharmacy','pharmacy_chain') then
    insert into public.partner_requirements(application_id,requirement_code,title)
    values(current.id,'active_pharmacy_location','At least one active licensed pharmacy location')
    on conflict(application_id,requirement_code) do nothing;
  end if;
  perform public.record_partner_event(current.id,auth.uid(),'partner.application.submitted.v1',current.relationship_status,updated.relationship_status,current.onboarding_stage,updated.onboarding_stage,null,target_correlation_id,target_idempotency_key);
  return updated;
end $$;
revoke all on function public.submit_partner_application(uuid,integer,text,text) from public;
grant execute on function public.submit_partner_application(uuid,integer,text,text) to authenticated;

create or replace function public.decide_partner_application(
  target_application_id uuid, target_decision text, target_reason text,
  target_existing_organization_id uuid, target_expected_version integer,
  target_idempotency_key text, target_correlation_id text
) returns public.partner_applications language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; updated public.partner_applications; resolved_org uuid; org_type public.organization_type; base_slug text; candidate_slug text;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required'; end if;
  select * into current from public.partner_applications where id=target_application_id for update;
  if not found then raise exception 'Partner application not found'; end if;
  if current.applicant_user_id=auth.uid() then raise exception 'Self-review is prohibited'; end if;
  if exists(select 1 from public.partner_decisions where application_id=current.id and idempotency_key=target_idempotency_key) then return current; end if;
  if current.version<>target_expected_version then raise exception 'Stale application version'; end if;
  if current.relationship_status not in ('under_review','needs_information') then raise exception 'Application is not reviewable'; end if;
  if target_decision not in ('approve','reject','request_information') then raise exception 'Invalid decision'; end if;
  if char_length(btrim(target_reason))<10 then raise exception 'A meaningful decision reason is required'; end if;
  if target_decision='approve' then
    if not exists(select 1 from public.partner_identity_claims where application_id=current.id and verification_status='verified') then raise exception 'Verified identity is required'; end if;
    if target_existing_organization_id is not null then
      select id into resolved_org from public.organizations where id=target_existing_organization_id and deleted_at is null;
      if resolved_org is null then raise exception 'Existing organization not found'; end if;
    else
      org_type:=case
        when current.partner_type in ('pharmacy','pharmacy_chain') then 'pharmacy'::public.organization_type
        when current.partner_type='manufacturer' then 'manufacturer'::public.organization_type
        when current.partner_type in ('distributor','wholesaler','logistics') then 'distributor'::public.organization_type
        when current.partner_type in ('healthcare_provider','hospital_clinic') then 'clinic'::public.organization_type
        when current.partner_type='payer_insurer' then 'hmo'::public.organization_type
        when current.partner_type='government_regulator' then 'government'::public.organization_type
        else 'technology'::public.organization_type end;
      base_slug:=trim(both '-' from regexp_replace(lower(current.legal_name),'[^a-z0-9]+','-','g'));
      candidate_slug:=base_slug||'-'||lower(substr(replace(current.id::text,'-',''),1,8));
      insert into public.organizations(name,slug,type) values(current.legal_name,candidate_slug,org_type) returning id into resolved_org;
    end if;
    update public.partner_identity_claims set organization_id=resolved_org where application_id=current.id;
    insert into public.organization_memberships(organization_id,user_id,role)
      values(resolved_org,current.applicant_user_id,case when current.partner_type in ('pharmacy','pharmacy_chain') then 'pharmacy_owner'::public.member_role else 'tenant_admin'::public.member_role end)
      on conflict(organization_id,user_id) do update set deleted_at=null;
    update public.partner_applications set organization_id=resolved_org,relationship_status='approved',onboarding_stage='agreement',approved_at=now(),version=version+1
      where id=current.id returning * into updated;
  elsif target_decision='reject' then
    update public.partner_applications set relationship_status='rejected',version=version+1 where id=current.id returning * into updated;
  else
    update public.partner_applications set relationship_status='needs_information',onboarding_stage='application',version=version+1 where id=current.id returning * into updated;
  end if;
  insert into public.partner_decisions(application_id,reviewer_id,decision,reason,idempotency_key)
  values(current.id,auth.uid(),target_decision,btrim(target_reason),target_idempotency_key);
  perform public.record_partner_event(current.id,auth.uid(),'partner.application.'||replace(target_decision,'_','-')||'.v1',current.relationship_status,updated.relationship_status,current.onboarding_stage,updated.onboarding_stage,target_reason,target_correlation_id,target_idempotency_key);
  return updated;
end $$;
revoke all on function public.decide_partner_application(uuid,text,text,uuid,integer,text,text) from public;
grant execute on function public.decide_partner_application(uuid,text,text,uuid,integer,text,text) to authenticated;

create or replace function public.record_partner_verification(
  target_application_id uuid,target_subject_type text,target_subject_id uuid,
  target_status public.partner_verification_status,target_evidence_reference text,
  target_evidence_digest text,target_notes text,target_idempotency_key text,target_correlation_id text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; verification_id uuid; next_stage public.partner_onboarding_stage;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required'; end if;
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id=auth.uid() then raise exception 'Self-review is prohibited'; end if;
  insert into public.partner_verification_records(application_id,subject_type,subject_id,status,reviewer_id,evidence_reference,evidence_digest,notes)
    values(current.id,target_subject_type,target_subject_id,target_status,auth.uid(),target_evidence_reference,target_evidence_digest,target_notes) returning id into verification_id;
  if target_subject_type='identity' and target_status='verified' then
    update public.partner_identity_claims set verification_status='verified',verified_at=now(),verified_by=auth.uid()
      where application_id=current.id and (target_subject_id is null or id=target_subject_id);
    update public.partner_requirements set status='satisfied',satisfied_by=auth.uid(),satisfied_at=now() where application_id=current.id and requirement_code='identity_verified';
    next_stage:='qualification';
  elsif target_subject_type='compliance' and target_status='verified' then
    update public.partner_requirements set status='satisfied',satisfied_by=auth.uid(),satisfied_at=now() where application_id=current.id and requirement_code='compliance_verified';
    next_stage:='agreement';
  else next_stage:=current.onboarding_stage; end if;
  update public.partner_applications set onboarding_stage=next_stage,version=version+1 where id=current.id;
  perform public.record_partner_event(current.id,auth.uid(),'partner.verification.recorded.v1',current.relationship_status,current.relationship_status,current.onboarding_stage,next_stage,target_notes,target_correlation_id,target_idempotency_key);
  return verification_id;
end $$;
revoke all on function public.record_partner_verification(uuid,text,uuid,public.partner_verification_status,text,text,text,text,text) from public;
grant execute on function public.record_partner_verification(uuid,text,uuid,public.partner_verification_status,text,text,text,text,text) to authenticated;

create or replace function public.issue_partner_agreement(
  target_application_id uuid,target_agreement_type text,target_version text,
  target_document_reference text,target_document_digest text,target_idempotency_key text,target_correlation_id text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; agreement_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required'; end if;
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id=auth.uid() then raise exception 'Self-review is prohibited'; end if;
  if current.relationship_status<>'approved' then raise exception 'Agreement requires an approved relationship'; end if;
  insert into public.partner_agreements(application_id,agreement_type,version,document_reference,document_digest,issued_by)
    values(current.id,target_agreement_type,target_version,target_document_reference,target_document_digest,auth.uid())
    on conflict(application_id,agreement_type,version) do update set document_reference=excluded.document_reference
    returning id into agreement_id;
  perform public.record_partner_event(current.id,auth.uid(),'partner.agreement.issued.v1',current.relationship_status,current.relationship_status,current.onboarding_stage,'agreement',null,target_correlation_id,target_idempotency_key);
  return agreement_id;
end $$;
revoke all on function public.issue_partner_agreement(uuid,text,text,text,text,text,text) from public;
grant execute on function public.issue_partner_agreement(uuid,text,text,text,text,text,text) to authenticated;

create or replace function public.accept_partner_agreement(
  target_application_id uuid,target_agreement_id uuid,target_idempotency_key text,target_correlation_id text
) returns public.partner_applications language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; updated public.partner_applications;
begin
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id is distinct from auth.uid() then raise exception 'Only the applicant may accept the agreement'; end if;
  update public.partner_agreements set accepted_by=auth.uid(),accepted_at=now()
    where id=target_agreement_id and application_id=current.id and revoked_at is null and accepted_at is null;
  if not found then raise exception 'Current agreement not found or already accepted'; end if;
  update public.partner_requirements set status='satisfied',satisfied_by=auth.uid(),satisfied_at=now() where application_id=current.id and requirement_code='agreement_accepted';
  update public.partner_applications set onboarding_stage='integration',version=version+1 where id=current.id returning * into updated;
  perform public.record_partner_event(current.id,auth.uid(),'partner.agreement.accepted.v1',current.relationship_status,current.relationship_status,current.onboarding_stage,updated.onboarding_stage,null,target_correlation_id,target_idempotency_key);
  return updated;
end $$;
revoke all on function public.accept_partner_agreement(uuid,uuid,text,text) from public;
grant execute on function public.accept_partner_agreement(uuid,uuid,text,text) to authenticated;

create or replace function public.update_partner_integration(
  target_application_id uuid,target_provider_kind text,target_endpoint_origin text,
  target_capabilities text[],target_status public.partner_integration_status,
  target_idempotency_key text,target_correlation_id text
) returns public.partner_integration_profiles language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; profile public.partner_integration_profiles; admin boolean;
begin
  select * into current from public.partner_applications where id=target_application_id for update;
  admin:=public.is_platform_admin();
  if not admin and not (current.organization_id is not null and public.has_organization_role(current.organization_id,array['tenant_admin','pharmacy_owner']::public.member_role[])) then raise exception 'Integration access denied'; end if;
  if target_status in ('certified','not_required') and not admin then raise exception 'Only a platform administrator may certify integration readiness'; end if;
  if admin and current.applicant_user_id=auth.uid() and target_status in ('certified','not_required') then raise exception 'Self-certification is prohibited'; end if;
  insert into public.partner_integration_profiles(application_id,provider_kind,endpoint_origin,capabilities,status,certified_by,certified_at,health_checked_at)
    values(current.id,target_provider_kind,target_endpoint_origin,coalesce(target_capabilities,'{}'),target_status,
      case when target_status in ('certified','not_required') then auth.uid() end,
      case when target_status in ('certified','not_required') then now() end,
      case when target_status='certified' then now() end)
    on conflict(application_id) do update set provider_kind=excluded.provider_kind,endpoint_origin=excluded.endpoint_origin,capabilities=excluded.capabilities,status=excluded.status,certified_by=excluded.certified_by,certified_at=excluded.certified_at,health_checked_at=excluded.health_checked_at
    returning * into profile;
  update public.partner_applications set integration_status=target_status,onboarding_stage='activation',version=version+1 where id=current.id;
  if target_status in ('certified','not_required') then update public.partner_requirements set status='satisfied',satisfied_by=auth.uid(),satisfied_at=now() where application_id=current.id and requirement_code='integration_certified'; end if;
  perform public.record_partner_event(current.id,auth.uid(),'partner.integration.updated.v1',current.relationship_status,current.relationship_status,current.onboarding_stage,'activation',null,target_correlation_id,target_idempotency_key);
  return profile;
end $$;
revoke all on function public.update_partner_integration(uuid,text,text,text[],public.partner_integration_status,text,text) from public;
grant execute on function public.update_partner_integration(uuid,text,text,text[],public.partner_integration_status,text,text) to authenticated;

create or replace function public.assess_partner_readiness(target_application_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; blockers text[]:='{}'; location_count integer:=0; ready_result boolean;
begin
  if not public.can_access_partner_application(target_application_id) then raise exception 'Application access denied'; end if;
  select * into current from public.partner_applications where id=target_application_id;
  if current.relationship_status<>'approved' then blockers:=array_append(blockers,'relationship_not_approved'); end if;
  if not exists(select 1 from public.partner_agreements where application_id=current.id and accepted_at is not null and revoked_at is null) then blockers:=array_append(blockers,'agreement_not_accepted'); end if;
  if current.integration_status not in ('certified','not_required') then blockers:=array_append(blockers,'integration_not_certified'); end if;
  if current.partner_type in ('pharmacy','pharmacy_chain') then
    select count(*) into location_count from public.pharmacy_locations where organization_id=current.organization_id and is_active and deleted_at is null;
    if location_count<1 then blockers:=array_append(blockers,'active_pharmacy_location_required');
    else update public.partner_requirements set status='satisfied',satisfied_by=auth.uid(),satisfied_at=coalesce(satisfied_at,now()) where application_id=current.id and requirement_code='active_pharmacy_location'; end if;
  end if;
  if exists(select 1 from public.partner_requirements where application_id=current.id and required and status not in ('satisfied','waived')) then blockers:=array_append(blockers,'requirements_incomplete'); end if;
  ready_result:=cardinality(blockers)=0;
  insert into public.partner_readiness_assessments(application_id,assessed_by,ready,blockers,evidence)
  values(current.id,auth.uid(),ready_result,blockers,jsonb_build_object('applicationVersion',current.version,'integrationStatus',current.integration_status,'activePharmacyLocations',location_count));
  return jsonb_build_object('ready',ready_result,'blockers',blockers,'applicationVersion',current.version);
end $$;
revoke all on function public.assess_partner_readiness(uuid) from public;
grant execute on function public.assess_partner_readiness(uuid) to authenticated;

create or replace function public.transition_partner_relationship(
  target_application_id uuid,target_transition text,target_reason text,
  target_expected_version integer,target_idempotency_key text,target_correlation_id text
) returns public.partner_applications language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; updated public.partner_applications; readiness jsonb; next_status public.partner_relationship_status; next_stage public.partner_onboarding_stage;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required'; end if;
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id=auth.uid() then raise exception 'Self-governance is prohibited'; end if;
  if exists(select 1 from public.partner_lifecycle_events where application_id=current.id and idempotency_key=target_idempotency_key) then return current; end if;
  if current.version<>target_expected_version then raise exception 'Stale application version'; end if;
  if target_transition='activate' then
    if current.relationship_status<>'approved' then raise exception 'Only approved relationships may activate'; end if;
    readiness:=public.assess_partner_readiness(current.id);
    if not (readiness->>'ready')::boolean then raise exception 'Partner is not ready for activation: %',readiness->'blockers'; end if;
    next_status:='active'; next_stage:='complete';
  elsif target_transition='suspend' and current.relationship_status='active' then next_status:='suspended'; next_stage:='complete';
  elsif target_transition='deactivate' and current.relationship_status in ('active','suspended') then next_status:='inactive'; next_stage:='complete';
  elsif target_transition='terminate' and current.relationship_status not in ('terminated','rejected') then next_status:='terminated'; next_stage:='complete';
  else raise exception 'Invalid lifecycle transition'; end if;
  if target_transition<>'activate' and char_length(btrim(target_reason))<10 then raise exception 'A meaningful lifecycle reason is required'; end if;
  update public.partner_applications set relationship_status=next_status,onboarding_stage=next_stage,version=version+1,
    activated_at=case when next_status='active' then now() else activated_at end,
    suspended_at=case when next_status='suspended' then now() else suspended_at end,
    terminated_at=case when next_status='terminated' then now() else terminated_at end
    where id=current.id returning * into updated;
  perform public.record_partner_event(current.id,auth.uid(),'partner.relationship.'||case target_transition
    when 'activate' then 'activated' when 'suspend' then 'suspended'
    when 'deactivate' then 'deactivated' else 'terminated' end||'.v1',
    current.relationship_status,updated.relationship_status,current.onboarding_stage,updated.onboarding_stage,
    target_reason,target_correlation_id,target_idempotency_key);
  update public.workflow_instances set status=case when next_status in ('active','terminated') then 'completed'::public.workflow_run_status else status end,
    completed_steps=case when next_status='active' then array['application','identity','qualification','compliance','agreement','integration','activation']::text[] else completed_steps end,
    context=context||jsonb_build_object('relationshipStatus',next_status,'stage',next_stage)
    where organization_id=public.partner_control_organization_id() and idempotency_key='partner:'||current.id;
  return updated;
end $$;
revoke all on function public.transition_partner_relationship(uuid,text,text,integer,text,text) from public;
grant execute on function public.transition_partner_relationship(uuid,text,text,integer,text,text) to authenticated;

alter table public.partner_applications enable row level security;
alter table public.partner_contacts enable row level security;
alter table public.partner_identity_claims enable row level security;
alter table public.partner_qualifications enable row level security;
alter table public.partner_verification_records enable row level security;
alter table public.partner_decisions enable row level security;
alter table public.partner_requirements enable row level security;
alter table public.partner_agreements enable row level security;
alter table public.partner_integration_profiles enable row level security;
alter table public.partner_readiness_assessments enable row level security;
alter table public.partner_status_history enable row level security;
alter table public.partner_lifecycle_events enable row level security;

create policy partner_applications_read on public.partner_applications for select to authenticated using (public.can_access_partner_application(id));
create policy partner_contacts_read on public.partner_contacts for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_identity_read on public.partner_identity_claims for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_qualifications_read on public.partner_qualifications for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_verifications_read on public.partner_verification_records for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_decisions_read on public.partner_decisions for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_requirements_read on public.partner_requirements for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_agreements_read on public.partner_agreements for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_integrations_read on public.partner_integration_profiles for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_readiness_read on public.partner_readiness_assessments for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_history_read on public.partner_status_history for select to authenticated using (public.can_access_partner_application(application_id));
create policy partner_events_read on public.partner_lifecycle_events for select to authenticated using (public.can_access_partner_application(application_id));

revoke all on public.partner_applications,public.partner_contacts,public.partner_identity_claims,
  public.partner_qualifications,public.partner_verification_records,public.partner_decisions,
  public.partner_requirements,public.partner_agreements,public.partner_integration_profiles,
  public.partner_readiness_assessments,public.partner_status_history,public.partner_lifecycle_events
  from anon,authenticated;
grant select on public.partner_applications,public.partner_contacts,public.partner_identity_claims,
  public.partner_qualifications,public.partner_verification_records,public.partner_decisions,
  public.partner_requirements,public.partner_agreements,public.partner_integration_profiles,
  public.partner_readiness_assessments,public.partner_status_history,public.partner_lifecycle_events
  to authenticated;

comment on table public.partner_applications is 'Partner relationship intake and lifecycle pointer. Canonical legal entities remain public.organizations.';
comment on table public.partner_identity_claims is 'Globally unique normalized identity claims prevent silent duplicate partner organizations.';
comment on table public.partner_lifecycle_events is 'Immutable, metadata-only Partner Engine lifecycle events mirrored transactionally to the runtime outbox.';
