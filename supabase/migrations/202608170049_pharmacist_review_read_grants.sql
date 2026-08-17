-- PostgREST requires a base table privilege before RLS can evaluate the
-- verified-pharmacist policies. These relations are all read by the existing
-- pharmacist review repository; writes remain exclusively RPC-governed.
grant select on public.prescriptions to authenticated, service_role;
grant select on public.prescription_items to authenticated, service_role;
grant select on public.clinical_findings to authenticated, service_role;
grant select on public.prescription_ocr_results to authenticated, service_role;
grant select on public.clinical_evidence_packages to authenticated, service_role;
grant select on public.prescription_files to authenticated, service_role;
