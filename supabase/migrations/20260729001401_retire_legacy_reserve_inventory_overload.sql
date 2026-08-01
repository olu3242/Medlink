-- Retires a duplicate reserve_inventory overload found while resolving a
-- merge conflict against the base branch.
--
-- 202607280008_atomic_reservation.sql (base branch, merged into this branch
-- after 20260729001001_reserve_inventory.sql was already written
-- independently) defines
-- reserve_inventory(uuid, uuid, uuid, uuid, integer, text, timestamptz) --
-- a different parameter list from this branch's
-- reserve_inventory(uuid, uuid, text, text, text, text, uuid, uuid, uuid,
-- integer, timestamptz) (202607290010). Postgres treats these as two
-- separate overloaded functions, not a replace, since `create or replace
-- function` only replaces a function with an identical signature.
--
-- apps/patient/lib/application.ts's AccessApplication.reserve() calls the
-- 11-parameter version, which additionally commits runtime evidence
-- (audit + outbox) in the same transaction via record_runtime_evidence --
-- the 7-parameter version does not. Nothing in the repository calls the
-- 7-parameter overload. Rather than leave two independently-maintained
-- implementations of the same operation to silently diverge, this drops
-- the one nothing uses.
drop function if exists public.reserve_inventory(
  uuid, uuid, uuid, uuid, integer, text, timestamptz
);
