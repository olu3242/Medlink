-- search_medicines is the bounded public projection over multiple protected
-- catalog relations. Execute it with its owner's read authority instead of
-- exposing ingredient, registration, and alias tables directly.
alter function public.search_medicines(text, text[], integer, integer)
  security definer;

-- Retain the existing fixed empty search_path and authenticated-only execute
-- grant from the canonical catalog migration.
