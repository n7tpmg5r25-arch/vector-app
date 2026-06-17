-- Thread 69 — /members count + /methodology cohort accuracy fix
--
-- Purpose: idempotent replay of the Thread 69 migration. The live run was
-- executed 2026-05-04 via Supabase MCP; this file exists so a disaster-recovery
-- rebuild (`docs/DISASTER-RECOVERY.md`) can replay the same state.
--
-- Safe to re-run: every statement is CREATE OR REPLACE.
--
-- Root cause this fixes:
--   /members and /methodology were doing client-side aggregation against bills,
--   which silently truncated at PostgREST's 1000-row default cap.
--   - /members count oscillated 146/147/148 across reloads (random 1000-row
--     slice → different distinct prime_sponsor counts each time).
--   - /methodology cohort N silently capped at 1000 even when 3,000+ scored
--     bills existed in the biennium.
--
-- Fix shape:
--   Three views move aggregation server-side. Pages now query <200 rows of
--   pre-aggregated data instead of streaming 3,400+ raw bills.
--
-- "Currently seated" rule:
--   A legislator is currently_seated for a biennium iff they cast >=1
--   roll-call vote in the final 30 days of the most recent session in that
--   biennium. Defensible: anyone with WSL access can replicate the count
--   from the public roll-call record. Auto-corrects for mid-biennium
--   vacancies + replacements without manual list maintenance.
--
-- 2025-2026 baseline verified at migration time: 98 House + 49 Senate = 147
-- (matches the WA constitutional seat count of 49 districts × 3 seats).
-- Bill Ramos (replaced by Hunt) and Tana Senn (replaced by Zahn) drop out
-- automatically; both prime-sponsored bills before resigning, so they
-- inflated the raw-distinct-sponsor count to 149.
--
-- Past biennia (2021-2022, 2023-2024) have no roll-call data synced (see
-- VOTE_DATA_FIRST_SESSION in app/lib/session-config.js). The
-- biennium_has_vote_data flag lets callers fall back to the full historical
-- roster for those biennia and only filter on currently_seated when the
-- signal is reliable.

-- ─────────────────────────────────────────────────────────────────────
-- View 1: v_active_legislators_by_session
-- One row per (biennium, member_id). currently_seated derives from
-- roll-call recency. biennium_has_vote_data lets callers choose whether
-- to apply the filter (only meaningful for biennia with roll-call data).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_active_legislators_by_session AS
WITH session_windows AS (
  SELECT
    b.session,
    MAX(rc.vote_date) AS session_end,
    COUNT(DISTINCT rc.id) AS roll_call_count
  FROM roll_calls rc
  JOIN bills b ON b.bill_id = rc.bill_id
  GROUP BY b.session
),
recent_voters AS (
  SELECT DISTINCT
    b.session,
    mv.member_id
  FROM member_votes mv
  JOIN roll_calls rc ON rc.id = mv.roll_call_id
  JOIN bills b ON b.bill_id = rc.bill_id
  JOIN session_windows sw ON sw.session = b.session
  WHERE rc.vote_date >= sw.session_end - INTERVAL '30 days'
    AND rc.vote_date <= sw.session_end
)
SELECT
  lph.biennium                                    AS session,
  lph.member_id,
  lph.full_name,
  lph.agency,
  lph.party,
  lph.district,
  (rv.member_id IS NOT NULL)                      AS currently_seated,
  COALESCE(sw.roll_call_count, 0) >= 50           AS biennium_has_vote_data,
  sw.session_end
FROM legislator_party_history lph
LEFT JOIN session_windows sw  ON sw.session  = lph.biennium
LEFT JOIN recent_voters   rv  ON rv.session  = lph.biennium AND rv.member_id = lph.member_id;

-- ─────────────────────────────────────────────────────────────────────
-- View 2: v_member_stats_by_session
-- Pre-aggregated per-(session, prime_sponsor) bill stats. Replaces the
-- client-side reduce loop in /members (which was hitting the 1000-row cap).
-- Joins to v_active_legislators_by_session to expose currently_seated.
--
-- Chamber/party are taken from legislator_party_history (canonical), not
-- from the LAST bill processed (which was the previous, brittle behavior
-- that gave unpredictable results for chamber-changers like Alvarado/Hunt).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_member_stats_by_session AS
WITH bill_agg AS (
  SELECT
    b.session,
    b.prime_sponsor                                                                       AS name,
    COUNT(*)                                                                              AS bill_count,
    SUM(CASE WHEN b.committee_passed   THEN 1 ELSE 0 END)                                 AS committee_passes,
    SUM(CASE WHEN b.has_public_hearing THEN 1 ELSE 0 END)                                 AS hearing_count,
    SUM(CASE WHEN b.outcome_passed_law THEN 1 ELSE 0 END)                                 AS laws_passed,
    COALESCE(ROUND(AVG(b.final_score)::numeric, 0), 0)::int                               AS avg_score,
    COALESCE(MAX(b.final_score), 0)                                                       AS top_score,
    COALESCE(BOOL_OR(b.is_committee_chair), false)                                        AS is_chair,
    COALESCE(MIN(b.sponsor_tier), 3)                                                      AS tier,
    ARRAY_AGG(DISTINCT b.committee_name)
      FILTER (WHERE b.committee_name IS NOT NULL AND b.committee_name <> '')              AS committees
  FROM bills b
  WHERE b.prime_sponsor IS NOT NULL AND b.prime_sponsor <> ''
  GROUP BY b.session, b.prime_sponsor
)
SELECT
  ba.session,
  ba.name,
  COALESCE(lph.agency, '?')                                AS chamber,
  COALESCE(lph.party,  '?')                                AS party,
  lph.member_id,
  lph.district,
  ba.bill_count,
  ba.committee_passes,
  ba.hearing_count,
  ba.laws_passed,
  ba.avg_score,
  ba.top_score,
  ba.is_chair,
  ba.tier,
  COALESCE(ba.committees, ARRAY[]::text[])                 AS committees,
  CASE
    WHEN ba.bill_count > 0 THEN ROUND((ba.committee_passes::numeric / ba.bill_count) * 100)::int
    ELSE 0
  END                                                      AS pass_rate,
  COALESCE(al.currently_seated, false)                     AS currently_seated,
  COALESCE(al.biennium_has_vote_data, false)               AS biennium_has_vote_data
FROM bill_agg ba
LEFT JOIN legislator_party_history       lph ON lph.full_name = ba.name AND lph.biennium = ba.session
LEFT JOIN v_active_legislators_by_session al ON al.member_id  = lph.member_id AND al.session = ba.session;

-- ─────────────────────────────────────────────────────────────────────
-- View 3: v_calibration_buckets_by_session
-- Pre-bucketed HIGH/MODERATE/LOW/VERY-LOW counts per session. Replaces
-- the JS-side reduce loop in /methodology (which was hitting the 1000-row
-- cap and silently truncating cohort N to 1000).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_calibration_buckets_by_session AS
SELECT
  session,
  CASE
    WHEN final_score >= 75 THEN 'HIGH'
    WHEN final_score >= 60 THEN 'MODERATE'
    WHEN final_score >= 45 THEN 'LOW'
    ELSE 'VERY LOW'
  END                                                                                  AS label,
  CASE
    WHEN final_score >= 75 THEN '75-99'
    WHEN final_score >= 60 THEN '60-74'
    WHEN final_score >= 45 THEN '45-59'
    ELSE '0-44'
  END                                                                                  AS bucket,
  COUNT(*)                                                                             AS bills,
  SUM(CASE WHEN confidence_label IN ('LAW','PASSED_CHAMBER') THEN 1 ELSE 0 END)        AS chamber_count,
  SUM(CASE WHEN confidence_label = 'LAW'                     THEN 1 ELSE 0 END)        AS law_count
FROM bills
WHERE final_score IS NOT NULL
GROUP BY session, label, bucket;

-- ─────────────────────────────────────────────────────────────────────
-- Permissions: views inherit RLS from underlying tables. anon role needs
-- SELECT on each view since /members and /methodology are public-tier.
-- ─────────────────────────────────────────────────────────────────────
GRANT SELECT ON v_active_legislators_by_session  TO anon, authenticated;
GRANT SELECT ON v_member_stats_by_session        TO anon, authenticated;
GRANT SELECT ON v_calibration_buckets_by_session TO anon, authenticated;
