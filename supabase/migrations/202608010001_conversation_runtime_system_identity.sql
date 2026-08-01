-- ADR 0004 (accepted): Conversation Runtime webhook identity, Option 2.
--
-- Provisions one fixed auth.users row used as the Conversation Runtime's
-- RuntimeContext.userId for every WhatsApp webhook delivery. An inbound
-- webhook has no Supabase-authenticated caller -- Meta calls the webhook
-- URL directly, authenticated only by packages/whatsapp's HMAC signature
-- verification (see apps/web/lib/whatsapp-webhook.ts) -- so there is no
-- real end-user session to source a userId from. This row exists purely so
-- RuntimeContext keeps its "userId is always a real, present UUID"
-- invariant intact rather than making the field optional, per ADR 0004's
-- recommendation (least blast radius: no existing Wave 1/2 RLS policy, RPC
-- signature, or audit consumer changes).
--
-- This identity is NOT used to call any actor-checked RPC (create_mar,
-- decide_clinical_review, reserve_inventory, record_runtime_evidence, ...):
-- every one of those requires a genuine `auth.uid()` match, which a
-- service-role connection (what the webhook route actually writes through)
-- can never produce. See ADR 0004's "Refinement discovered during
-- implementation" section. Its only present purpose is populating
-- RuntimeContext.userId for telemetry/tracing/correlation and, if a future
-- pass mints it a real signed session, becoming a well-known actor to
-- attribute webhook-driven governance events to instead of a null gap.
--
-- CAUTION: unlike every other migration in this repository, this one
-- inserts into `auth.users` (GoTrue's schema), not `public.*`. It has not
-- been executed against a live Supabase instance -- this repository's test
-- suite is unit/contract-level only (see the "8 skipped, live-DB" note
-- throughout docs/audit/*) and has no live Postgres to apply migrations
-- against. Verify this applies cleanly in a real environment (`supabase db
-- reset` against a real project, or a staging migration run) before this is
-- treated as certified, not just source-correct.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'whatsapp-webhook@system.medlink.internal',
  '',
  now(),
  '{"provider": "system", "providers": ["system"]}'::jsonb,
  '{}'::jsonb,
  false,
  now(),
  now()
)
on conflict (id) do nothing;

comment on table auth.users is
  'GoTrue-managed. One row, id 11111111-1111-4111-8111-111111111111, is the Conversation Runtime system identity provisioned by migration 202608010001 per ADR 0004 -- not a real end user, never logs in, authenticated only by packages/whatsapp webhook signature verification.';
