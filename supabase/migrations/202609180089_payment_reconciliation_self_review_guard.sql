-- Authorization convergence repair, item 7: separation of duties for the
-- one manual/high-risk financial action that exists today --
-- resolve_payment_reconciliation_case (202608180070_network_transaction_policy.sql).
-- Every other money-moving path in the codebase (apply_payment_provider_event,
-- apply_refund_provider_event, initiate_reservation_refund_on_exit,
-- capture_payment_reconciliation_event, open_payment_reconciliation_case) is
-- automated and provider/trigger-driven with no human decision step, so per
-- the business rule ("normal automated provider-confirmed settlement
-- processing should not require unnecessary human approval") those are left
-- untouched.
--
-- payment_reconciliation_cases itself has no human "initiator" column --
-- cases are opened only by a trigger or a service-role call, never by a
-- person -- so there is no initiator to separate from the resolving admin
-- via that table alone. The case does carry payment_id, and payments.created_by
-- identifies the person who made the underlying payment (see
-- create_payment_attempt); reusing that existing relationship, rather than
-- adding a new column, closes the concrete risk this guard exists for: a
-- platform_admin resolving a reconciliation case in favor of a payment they
-- themselves made. Same shape as decide_partner_application and
-- decide_clinical_review's self-review guards: look up the initiating
-- identity via an existing foreign key, compare it to the deciding actor,
-- raise before any mutation.
create or replace function public.resolve_payment_reconciliation_case(
  target_case_id uuid,target_resolution text,target_evidence_reference text
) returns public.payment_reconciliation_cases language plpgsql security definer set search_path = '' as $$
declare
  current public.payment_reconciliation_cases;
  payment_initiator uuid;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required' using errcode='42501'; end if;
  if btrim(coalesce(target_resolution,''))='' or btrim(coalesce(target_evidence_reference,''))='' then
    raise exception 'Evidence-backed reconciliation resolution is required';
  end if;
  select * into current from public.payment_reconciliation_cases where id=target_case_id for update;
  if not found then raise exception 'Payment reconciliation case not found'; end if;
  if current.status='resolved' then return current; end if;

  if current.payment_id is not null then
    select created_by into payment_initiator from public.payments where id=current.payment_id;
    if payment_initiator is not null and payment_initiator=auth.uid() then
      raise exception 'Self-review is prohibited';
    end if;
  end if;

  update public.payment_reconciliation_cases set status='resolved',
    resolution=target_resolution||' | evidence='||target_evidence_reference,
    resolved_by=auth.uid(),resolved_at=now() where id=target_case_id returning * into current;
  insert into public.governance_audit_events(
    organization_id,event_type,actor_id,actor_type,resource_type,resource_id,
    action,outcome,correlation_id,request_id,idempotency_key,source_channel,metadata
  ) values(current.organization_id,'payment.reconciliation',auth.uid(),'user',
    'payment_reconciliation_case',current.id::text,'payment.reconciliation.resolve','success',
    current.provider_event_reference,current.provider_event_reference,
    'payment-reconciliation:'||current.id::text,'admin',
    jsonb_build_object('paymentId',current.payment_id,'reason',current.reason,
      'evidenceReference',target_evidence_reference));
  if current.payment_id is not null and not exists(
    select 1 from public.payment_reconciliation_cases pending
    where pending.payment_id=current.payment_id and pending.status='open'
  ) then
    update public.payments set reconciliation_required=false where id=current.payment_id;
  end if;
  return current;
end;
$$;

comment on function public.resolve_payment_reconciliation_case is
  'Platform-admin resolution of a flagged payment/refund discrepancy. The resolving admin must not be the person who made the underlying payment (self-review prohibited); automated provider-confirmed processing elsewhere is unaffected by this guard.';
