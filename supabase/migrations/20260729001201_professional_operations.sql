-- Professional portal identity. Kept separate because PostgreSQL requires a
-- commit before a newly added enum value can be used safely.
alter type public.member_role add value if not exists 'provider';
