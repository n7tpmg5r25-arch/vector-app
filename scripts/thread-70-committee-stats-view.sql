-- Thread 70 — /committees aggregation parity (same fix as Thread 69)
--
-- Purpose: idempotent replay of the Thread 70 migration. The live run was
-- executed 2026-05-06 via Supabase MCP; this file exists so a disaster-recovery
-- rebuild (`docs/DISASTER-RECOVERY.md`) can replay the same state.
--
-- Safe to re-run: every statement is CREATE OR REPLACE.
--
-- Root cause this fixes:
--   /committees was fetching all bills with non-null committee_name via
--   .range(0, 2999) ordered by final_score DESC, then doing a client-side
--   reduce loop to build per-(committee_name, chamber) stats.
--   PostgREST silently truncates at db-max-rows=1000 regardless of the
--   Range header, so 2,133 of 3,133 bills (~68%) were dropped on every
--   page load. Worse: ORDER BY final_score DESC meant the surviving slice
--   was the top-1000-scoring bills, so committees with all-low-score bills
--   disappeared entirely from the page.
--
-- Pre-fix vs post-fix per session:
--   Session     Uncapped rows  Pre-fix (capped)  Post-fix (view)
--   2025-2026         3,133            1,000              3,133
--   2023-2024         2,867            1,000              2,867
--   2021-2022         2,152            1,000              2,152
--
-- Fix shape:
--   One view returning ~65 rows of pre-aggregated per-committee stats.
--   /committees page now queries the view; expand-on-click bills became a
--   lazy fetch (one bounded query per expansion, top 20 by score).
--
-- Pages NOT touched (verified safely under the cap):
--   /committees/[slug]: largest single (committee_name, chamber) bucket is
--     Senate / Rules 2 Review at 372 bills << 1000 row cap.
--   /hearings: explicit .limit(200) caller-side, well under the cap.
--
-- Procedural-shelf override (Thread 15.3) preserved in JS-side isRules():
--   Both `Rules 2 Review` rows ARE flagged is_rules=true in the committees
--   table (verified at migration time), so the JS PROCEDURAL_SHELF_NAMES
--   override is currently a no-op — but kept as defense-in-depth in case
--   future syncs reset the flag.

-- ─────────────────────────────────────────────────────────────────────
-- View: v_committee_stats_by_session
-- One row per (session, committee_name, chamber). Pre-aggregates every
-- stat the /committees By-Committee view consumes:
--   bill_count, committee_passes, hearing_count, high_score_count (>=50),
--   stalled_count, avg_score, top_score, pass_rate
--
-- LEFT JOIN to committees provides is_rules + slug. ~6% of bill buckets
-- don't have a matching committees row (mostly malformed names like
-- "Health Care & Wellness (Not Officially read and referred...)"); these
-- gracefully get is_rules=false + NULL slug. The page already early-returns
-- in goToCommittee() when slug is missing.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_committee_stats_by_session AS
WITH committee_agg AS (
  SELECT
    b.session,
    b.committee_name                                                       AS name,
    b.chamber,
    COUNT(*)                                                               AS bill_count,
    SUM(CASE WHEN b.committee_passed   THEN 1 ELSE 0 END)                  AS committee_passes,
    SUM(CASE WHEN b.has_public_hearing THEN 1 ELSE 0 END)                  AS hearing_count,
    SUM(CASE WHEN COALESCE(b.final_score, 0) >= 50 THEN 1 ELSE 0 END)      AS high_score_count,
    SUM(CASE WHEN b.stalled            THEN 1 ELSE 0 END)                  AS stalled_count,
    COALESCE(ROUND(AVG(b.final_score)::numeric, 0), 0)::int                AS avg_score,
    COALESCE(MAX(b.final_score), 0)                                        AS top_score
  FROM bills b
  WHERE b.committee_name IS NOT NULL AND b.committee_name <> ''
  GROUP BY b.session, b.committee_name, b.chamber
)
SELECT
  ca.session,
  ca.name,
  ca.chamber,
  ca.bill_count,
  ca.committee_passes,
  ca.hearing_count,
  ca.high_score_count,
  ca.stalled_count,
  ca.avg_score,
  ca.top_score,
  CASE
    WHEN ca.bill_count > 0 THEN ROUND((ca.committee_passes::numeric / ca.bill_count) * 100)::int
    ELSE 0
  END                                                                      AS pass_rate,
  COALESCE(c.is_rules, false)                                              AS is_rules,
  c.slug
FROM committee_agg ca
LEFT JOIN committees c
  ON LOWER(c.name) = LOWER(ca.name)
 AND c.chamber    = ca.chamber;

-- ─────────────────────────────────────────────────────────────────────
-- Permissions: /committees is public-tier per proxy.js isPublicLayerRoute().
-- Views inherit RLS from underlying tables but require explicit GRANT.
-- ─────────────────────────────────────────────────────────────────────
GRANT SELECT ON v_committee_stats_by_session TO anon, authenticated;
