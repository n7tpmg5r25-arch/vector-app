/**
 * VECTOR | WA — Radar Detection (Thread R2, Phase 1)
 *
 * Runs after detect-alerts.js in the GitHub Actions sync jobs.
 *
 * Where detect-alerts.js is BILL-centric (changes to bills a user already
 * tracks), detect-radar.js is TERM-centric: it answers the prior lobbyist
 * question — "did a brand-new bill that touches my issues / clients / places
 * just get introduced?" It scans current-session bills against each enabled
 * radar term using Postgres full-text search and fans out one match row per
 * (term, bill).
 *
 * Phase 1 trigger: NEW BILL match.
 *   For each enabled term, find current-session bills where
 *     created_at > term.last_checked_at
 *     AND the term query matches (search_tsv for scope 'all', title-only
 *         tsvector for scope 'title') — via the radar_match_bills() RPC.
 *   Skip (term, bill) pairs already recorded in radar_matches (fire-once).
 *   Insert radar_matches(match_reason='new_bill'). For cadence='immediate'
 *   terms, also insert an alert_events(event_type='radar_match') row so the
 *   existing send-alerts edge function emails it, then backfill
 *   radar_matches.alert_event_id. Per-term daily_cap bounds how many matches
 *   email per day; overflow stays in the ledger only (surfaces in the Radar
 *   feed + future digest, not the immediate email).
 *
 * Writes ONLY to radar_matches + alert_events. Never touches sync, scoring,
 * or the bills write-path. Dedup via the radar_matches UNIQUE
 * (term_id, bill_id, match_reason) constraint keeps re-runs idempotent.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node app/lib/detect-radar.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Current session ────────────────────────────────────────
// Mirrors app/lib/session-config.js getCurrentSession() so the detector
// stays in lockstep with the rest of the app as biennia roll forward.
// NOTE: bills.session uses the long form ('2025-2026'), so we return that
// shape here — NOT the short 'CURRENT_BIENNIUM' env value ('2025-26') the
// sync jobs pass to sync-v2.js. An optional RADAR_SESSION env can override
// for testing against a historical session.
const BIENNIUMS = [
  { session: '2025-2026', start: '2025-01-13', prefilingOpens: null },
  { session: '2027-2028', start: '2027-01-11', prefilingOpens: '2026-12-01' },
];

function getCurrentSession() {
  const now = new Date();
  for (let i = BIENNIUMS.length - 1; i >= 0; i--) {
    const trigger = BIENNIUMS[i].prefilingOpens || BIENNIUMS[i].start;
    if (now >= new Date(trigger)) return BIENNIUMS[i].session;
  }
  return BIENNIUMS[0].session;
}

const CURRENT_SESSION = process.env.RADAR_SESSION || getCurrentSession();

// Upper bound on rows pulled per term per run (ledger capture). The per-term
// daily_cap separately bounds how many of those email immediately.
const MATCH_FETCH_LIMIT = 500;

function startOfUtcTodayISO() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Main ───────────────────────────────────────────────────

async function detectRadar() {
  const start = Date.now();
  console.log('=== Radar Detection ===');
  console.log(`Current session: ${CURRENT_SESSION}`);

  // 1. Enabled terms
  const { data: terms, error: termErr } = await supabase
    .from('radar_terms')
    .select('id, user_id, label, client_id, query, match_scope, cadence, enabled, daily_cap, last_checked_at')
    .eq('enabled', true);

  if (termErr) {
    console.error('Error fetching radar terms:', termErr.message);
    process.exit(1);
  }

  if (!terms || terms.length === 0) {
    console.log('No enabled radar terms. Done.');
    return;
  }

  console.log(`Found ${terms.length} enabled radar term(s).`);

  // 2. Client labels (small table) for the email "client chip"
  const clientLabels = new Map();
  const clientIds = [...new Set(terms.map(t => t.client_id).filter(Boolean))];
  if (clientIds.length > 0) {
    const { data: clients, error: cErr } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds);
    if (cErr) {
      console.warn('  [clients lookup failed]:', cErr.message);
    } else {
      for (const c of clients || []) clientLabels.set(c.id, c.name);
    }
  }

  let totalLedger = 0;
  let totalAlerts = 0;

  // 3. Per-term detection
  for (const term of terms) {
    const runStamp = new Date().toISOString();
    const clientLabel = term.client_id ? (clientLabels.get(term.client_id) || null) : null;
    const titleOnly = term.match_scope === 'title';

    // 3a. FTS match via RPC (handles both 'all' and 'title' scope).
    const { data: matches, error: mErr } = await supabase.rpc('radar_match_bills', {
      p_query: term.query,
      p_session: CURRENT_SESSION,
      p_since: term.last_checked_at,
      p_title_only: titleOnly,
      p_limit: MATCH_FETCH_LIMIT,
    });

    if (mErr) {
      console.warn(`  [term ${term.id} "${term.label}" match query failed]: ${mErr.message}`);
      continue; // do NOT advance last_checked_at on failure — retry next run
    }

    const candidates = matches || [];
    if (candidates.length === 0) {
      await advanceLastChecked(term.id, runStamp);
      continue;
    }

    // 3b. Dedup against existing ledger rows for this (term, new_bill).
    const candidateBillIds = candidates.map(b => b.bill_id);
    const existing = new Set();
    for (let i = 0; i < candidateBillIds.length; i += 500) {
      const batch = candidateBillIds.slice(i, i + 500);
      const { data: seen, error: sErr } = await supabase
        .from('radar_matches')
        .select('bill_id')
        .eq('term_id', term.id)
        .eq('match_reason', 'new_bill')
        .in('bill_id', batch);
      if (sErr) {
        console.warn(`  [term ${term.id} dedup read failed]: ${sErr.message}`);
      } else {
        for (const r of seen || []) existing.add(r.bill_id);
      }
    }

    // Oldest-first so the daily cap, if hit, favors the earliest-introduced.
    const fresh = candidates
      .filter(b => !existing.has(b.bill_id))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (fresh.length === 0) {
      await advanceLastChecked(term.id, runStamp);
      continue;
    }

    // 3c. Insert ledger rows (alert_event_id backfilled below for immediate).
    const ledgerRows = fresh.map(b => ({
      term_id: term.id,
      user_id: term.user_id,
      bill_id: b.bill_id,
      match_reason: 'new_bill',
    }));

    // ignoreDuplicates absorbs any race against the UNIQUE constraint; we read
    // back the rows we actually own (with their ids) for the alert backfill.
    const { error: insErr } = await supabase
      .from('radar_matches')
      .upsert(ledgerRows, {
        onConflict: 'term_id,bill_id,match_reason',
        ignoreDuplicates: true,
      });
    if (insErr) {
      console.warn(`  [term ${term.id} ledger insert failed]: ${insErr.message}`);
      continue; // retry next run; last_checked_at not advanced
    }

    // Read back this run's ledger rows (id + bill_id) for the fresh bills.
    const freshBillIds = fresh.map(b => b.bill_id);
    const ledgerById = new Map();
    for (let i = 0; i < freshBillIds.length; i += 500) {
      const batch = freshBillIds.slice(i, i + 500);
      const { data: rows } = await supabase
        .from('radar_matches')
        .select('id, bill_id, alert_event_id')
        .eq('term_id', term.id)
        .eq('match_reason', 'new_bill')
        .in('bill_id', batch);
      for (const r of rows || []) ledgerById.set(r.bill_id, r);
    }

    totalLedger += fresh.length;

    // 3d. Immediate cadence → alert_events, bounded by daily_cap.
    if (term.cadence === 'immediate') {
      const cap = Number.isFinite(term.daily_cap) ? term.daily_cap : 25;

      // How many immediate alerts has this term already fired today?
      const { count: firedToday } = await supabase
        .from('radar_matches')
        .select('id', { count: 'exact', head: true })
        .eq('term_id', term.id)
        .not('alert_event_id', 'is', null)
        .gte('detected_at', startOfUtcTodayISO());

      const remaining = Math.max(0, cap - (firedToday || 0));
      const toAlert = fresh.slice(0, remaining);
      const billMeta = new Map(fresh.map(b => [b.bill_id, b]));

      // Build alert rows only for ledger rows that don't yet have an event.
      const alertRows = [];
      for (const b of toAlert) {
        const ledger = ledgerById.get(b.bill_id);
        if (!ledger || ledger.alert_event_id) continue; // already alerted
        alertRows.push({
          bill_id: b.bill_id, // alert_events.bill_id is NOT NULL — always set
          user_id: term.user_id,
          event_type: 'radar_match',
          event_data: {
            term_id: term.id,
            term_label: term.label,
            client_label: clientLabel,
            query: term.query,
            bill_number: b.bill_number,
            bill_title: b.title,
            match_reason: 'new_bill',
          },
        });
      }

      if (alertRows.length > 0) {
        const { data: inserted, error: aErr } = await supabase
          .from('alert_events')
          .insert(alertRows)
          .select('id, bill_id');
        if (aErr) {
          console.warn(`  [term ${term.id} alert_events insert failed]: ${aErr.message}`);
        } else {
          // Backfill radar_matches.alert_event_id per (term, bill).
          for (const ev of inserted || []) {
            const ledger = ledgerById.get(ev.bill_id);
            if (!ledger) continue;
            const { error: upErr } = await supabase
              .from('radar_matches')
              .update({ alert_event_id: ev.id })
              .eq('id', ledger.id);
            if (upErr) {
              console.warn(`  [term ${term.id} alert_event_id backfill failed for ${ev.bill_id}]: ${upErr.message}`);
            }
          }
          totalAlerts += inserted?.length || 0;
        }
      }

      const overflow = fresh.length - toAlert.length;
      console.log(
        `  term ${term.id} "${term.label}": ${fresh.length} new match(es), ` +
        `${alertRows.length} emailed${overflow > 0 ? `, ${overflow} ledger-only (daily cap ${cap})` : ''}.`
      );
      void billMeta;
    } else {
      console.log(`  term ${term.id} "${term.label}": ${fresh.length} new match(es), digest cadence (ledger only).`);
    }

    // 3e. Advance the watermark only after a fully successful pass.
    await advanceLastChecked(term.id, runStamp);
  }

  const duration = Date.now() - start;
  console.log(`Radar detection complete: ${totalLedger} ledger row(s), ${totalAlerts} immediate alert(s) in ${duration}ms.`);
}

async function advanceLastChecked(termId, stampISO) {
  const { error } = await supabase
    .from('radar_terms')
    .update({ last_checked_at: stampISO })
    .eq('id', termId);
  if (error) {
    console.warn(`  [term ${termId} last_checked_at update failed]: ${error.message}`);
  }
}

// ── Run ────────────────────────────────────────────────────

detectRadar().catch(err => {
  console.error('Radar detection failed:', err);
  process.exit(1);
});
