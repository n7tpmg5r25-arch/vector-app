-- Phase 13a backfill — Shorepine Internal client + existing tracked_bills
--
-- Purpose: idempotent replay of the Phase 13a backfill. The live run was
-- executed 2026-04-21 via Supabase MCP; this file exists so a disaster-recovery
-- rebuild (`docs/DISASTER-RECOVERY.md`) can replay the same state.
--
-- Safe to re-run: every step uses ON CONFLICT / WHERE ... IS NULL guards.
--
-- Pre-conditions:
--   1. Migration `phase_13a_client_portal_foundation` has been applied.
--   2. At least one row exists in auth.users with the owner email (Colin).
--   3. `clients`, `client_users`, `tracked_bills.client_id` are all present.
--
-- Post-conditions:
--   - `clients` has a row with slug='internal', name='Shorepine Internal'.
--   - `client_users` has the owner mapped to that client as role='viewer'.
--   - All `tracked_bills` rows have `client_id` pointing at the internal client.
--
-- Run with the service_role key (NOT anon) since RLS would otherwise block the
-- owner INSERT/UPDATE. Easiest path: paste into Supabase SQL editor.

-- ── 1. Locate the owner user (Colin) ──────────────────────────────────────
-- NOTE: this script hardcodes the owner email to avoid ambiguity if extra
-- users are created later. Update the email literal if it changes.
do $$
declare
  _owner_uid  uuid;
  _client_id  uuid;
begin
  select id into _owner_uid
  from auth.users
  where email = 'cjfoot@gmail.com'
  limit 1;

  if _owner_uid is null then
    raise exception 'phase-13a backfill: owner auth.users row not found; aborting';
  end if;

  -- ── 2. Shorepine Internal client ────────────────────────────────────────
  insert into public.clients (slug, name, status, created_by)
  values ('internal', 'Shorepine Internal', 'active', _owner_uid)
  on conflict (slug) do nothing;

  select id into _client_id from public.clients where slug = 'internal';

  -- ── 3. Colin as a viewer of the internal client ─────────────────────────
  insert into public.client_users (client_id, user_id, role, accepted_at)
  values (_client_id, _owner_uid, 'viewer', now())
  on conflict (client_id, user_id) do nothing;

  -- ── 4. Backfill tracked_bills.client_id ─────────────────────────────────
  update public.tracked_bills
  set client_id = _client_id
  where client_id is null;

  raise notice 'phase-13a backfill complete: client_id=%, owner=%', _client_id, _owner_uid;
end $$;

-- ── Verification (run standalone to confirm) ──────────────────────────────
-- select count(*) filter (where client_id is not null) as scoped,
--        count(*) filter (where client_id is null)     as unscoped
-- from public.tracked_bills;
