-- Phase 13a RLS smoke test — 9-row permission matrix.
--
-- Exercises every RLS boundary added in migration
-- `phase_13a_client_portal_foundation`:
--   • anon cannot SELECT clients, client_users, or any tracked_bills row.
--   • Colin (owner) sees only the clients / memberships / tracked_bills he
--     belongs to (the Shorepine Internal client in production).
--   • A seeded test client user sees only rows scoped to THEIR client, and
--     NOT Colin's owner-scoped tracked_bills rows.
--
-- The entire script runs inside BEGIN ... ROLLBACK so nothing persists. Safe
-- to replay on production any time. Run via Supabase SQL editor (service
-- role) — SET LOCAL ROLE is blocked from anon/authenticated clients.
--
-- Expected output (9 rows, all result='PASS'):
--   anon: clients               | anon        | 0  | 0  | PASS
--   anon: client_users          | anon        | 0  | 0  | PASS
--   anon: tracked_bills         | anon        | 0  | 0  | PASS
--   owner: clients              | colin       | 1  | 1  | PASS
--   owner: client_users         | colin       | 1  | 1  | PASS
--   owner: tracked_bills        | colin       | 10 | 10 | PASS
--   client-user: clients        | test-client | 1  | 1  | PASS
--   client-user: client_users   | test-client | 1  | 1  | PASS
--   client-user: tracked_bills  | test-client | 1  | 1  | PASS

begin;

-- ── Fixtures (all rolled back) ────────────────────────────────────────────
insert into auth.users (id, email, aud, role, instance_id, created_at, updated_at)
values (
  '11111111-1111-1111-1111-111111111111',
  'test-client@example.test',
  'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000',
  now(), now()
);

insert into public.clients (id, slug, name, status, created_by)
values (
  '22222222-2222-2222-2222-222222222222',
  'acme-test', 'Acme Law Group (Test)', 'active',
  (select id from auth.users where email = 'cjfoot@gmail.com' limit 1)
);

insert into public.client_users (client_id, user_id, role, accepted_at)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'viewer', now()
);

-- One tracked_bills row scoped ONLY to the test client (user_id NULL).
-- Borrow an arbitrary bill_id from the existing watchlist.
insert into public.tracked_bills (user_id, bill_id, client_id, added_at)
select null, bill_id, '22222222-2222-2222-2222-222222222222', now()
from public.tracked_bills
where client_id is not null
limit 1;

create temp table test_results (label text, phase text, rows_visible int, expected int);

-- ── Test 1: anon ──────────────────────────────────────────────────────────
set local role anon;

insert into test_results
select 'anon: clients',          'anon', count(*), 0 from public.clients
union all
select 'anon: client_users',     'anon', count(*), 0 from public.client_users
union all
select 'anon: tracked_bills',    'anon', count(*), 0 from public.tracked_bills;

reset role;

-- ── Test 2: owner Colin ───────────────────────────────────────────────────
-- Simulate an authenticated JWT for Colin.
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub',  (select id::text from auth.users where email = 'cjfoot@gmail.com' limit 1),
    'role', 'authenticated'
  )::text,
  true);
set local role authenticated;

insert into test_results
select 'owner: clients',         'colin', count(*), 1  from public.clients
union all
select 'owner: client_users',    'colin', count(*), 1  from public.client_users
union all
-- Owner policy admits Colin's 10 rows; acme-test's 1 row is NOT owned by him
-- and he is NOT a client_users member of acme-test, so it stays invisible.
select 'owner: tracked_bills',   'colin', count(*), 10 from public.tracked_bills;

-- ── Test 3: test client user ──────────────────────────────────────────────
select set_config('request.jwt.claims',
  jsonb_build_object(
    'sub',  '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true);
-- role already authenticated

insert into test_results
select 'client-user: clients',       'test-client', count(*), 1 from public.clients
union all
select 'client-user: client_users',  'test-client', count(*), 1 from public.client_users
union all
-- Test user belongs only to acme-test; should see its 1 scoped row, none of
-- Colin's 10 private owner rows.
select 'client-user: tracked_bills', 'test-client', count(*), 1 from public.tracked_bills;

reset role;
select set_config('request.jwt.claims', '', true);

-- ── Results ───────────────────────────────────────────────────────────────
select label, phase, rows_visible, expected,
       case when rows_visible = expected then 'PASS' else 'FAIL' end as result
from test_results
order by phase, label;

rollback;
