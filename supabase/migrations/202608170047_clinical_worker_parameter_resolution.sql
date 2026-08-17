-- PostgreSQL treats a schema-qualified PL/pgSQL block parameter such as
-- public.function_name.parameter as a table reference. Repair the five
-- already-installed worker functions forward-only while preserving their
-- complete definitions, privileges, security-definer status, and search path.
do $repair$
declare
  target record;
  definition text;
  parameter_name text;
  audit_insert_at integer;
begin
  for target in
    select * from (values
      ('public.claim_clinical_pipeline_stage(text,integer)',
       'claim_clinical_pipeline_stage', array['worker_id', 'lease_seconds']),
      ('public.complete_clinical_ocr(uuid,text,uuid,jsonb)',
       'complete_clinical_ocr', array['source_event_id', 'worker_id', 'lease_token', 'result']),
      ('public.complete_clinical_parsing(uuid,text,uuid,jsonb)',
       'complete_clinical_parsing', array['source_event_id', 'worker_id', 'lease_token', 'extraction']),
      ('public.complete_clinical_validation(uuid,text,uuid,jsonb)',
       'complete_clinical_validation', array['source_event_id', 'worker_id', 'lease_token', 'findings']),
      ('public.fail_clinical_pipeline_stage(uuid,text,uuid,text,boolean)',
       'fail_clinical_pipeline_stage', array['source_event_id', 'worker_id', 'lease_token', 'error_code', 'retryable'])
    ) as functions(signature, function_name, parameter_names)
  loop
    select pg_get_functiondef(target.signature::regprocedure) into strict definition;
    foreach parameter_name in array target.parameter_names loop
      definition := replace(
        definition,
        'public.' || target.function_name || '.' || parameter_name,
        parameter_name
      );
    end loop;
    if target.function_name = 'complete_clinical_ocr' then
      audit_insert_at := strpos(definition, 'insert into public.ai_audit_events');
      definition := left(definition, audit_insert_at - 1)
        || regexp_replace(
          substr(definition, audit_insert_at),
          'on conflict on constraint workflow_run_events_organization_id_idempotency_key_key',
          'on conflict (organization_id, idempotency_key)'
        );
    end if;
    if target.function_name = 'claim_clinical_pipeline_stage' then
      definition := replace(
        definition,
        'where id = context_row.extraction_id;',
        'where id = context_row.extraction_id'
          || chr(10) || '    and claimed_stage <> ''clinical_validation'';'
      );
    end if;
    execute definition;
  end loop;
end
$repair$;
