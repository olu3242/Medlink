-- The Partner Engine control plane and technology/API partners are canonical
-- organizations, not a parallel tenant model. PostgreSQL requires a newly
-- added enum value to be committed before a later migration may use it.
alter type public.organization_type add value if not exists 'technology';
