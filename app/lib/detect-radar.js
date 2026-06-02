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
 * Phase 2 trigger (Thread R4): MATERIAL CHANGE re-match.
 *   The new-bill pass only sees a bill the day it is introduced. Phase 2 also
 *   catches a bill that gets SUBSTITUTED, AMENDED, or RE-SUMMARIZED into a term
 *   afterwards. We keep a per-bill snapshot in radar_bill_state
 *   (amendment_count, substitute_filed, summary_hash, ai_summary_hash). Each
 *   run we compare the live snapshot to the stored one; bills whose
 *   substitute_filed flipped false→true, whose amendment_count rose, or whose
 *   summary/ai_summary hash changed are re-matched against every enabled term
 *   and written as radar_matches(match_reason='material_change') + (immediate,
 *   radar_enabled) alert_events. radar_bill_state is then refreshed for the
 *   moved bills. THE FIRST RUN SEEDS radar_bill_state SILENTLY (no prior state
 *   = no material-change alerts) so existing substitutes/amendments don't flood.
 *
 * Phase 3b triggers (Thread R6): NEW LANGUAGE diff + FULLTEXT scope.
 *   Phases 1–2 match against title / summary / ai_summary only. R5 began
 *   archiving the real bill text into bill_text_versions; R6 turns that archive
 *   into language intelligence:
 *     • NEW LANGUAGE — for bills with >= 2 archived text versions, diff the two
 *       most recent (added lines only) and re-run each enabled non-title term
 *       against just the ADDED text. A hit writes
 *       radar_matches(match_reason='new_language', snippet=<bounded excerpt>) +
 *       (immediate) alert_events, so the email can QUOTE the language that
 *       literally changed — not just say that it changed.
 *     • FULLTEXT scope — a term whose match_scope='fulltext' is matched against
 *       the latest archived bill_text_versions.text (its own tsvector + GIN
 *       index) rather than title/summary. These terms are handled ONLY in the
 *       fulltext pass (skipped in the new-bill + material passes) and fire as
 *       match_reason='new_bill'.
 *   Both passes reuse emitMatches() for dedup / cap / backfill. The
 *   radar_matches UNIQUE (term, bill, reason) constraint means a given
 *   (term, bill) fires at most once per reason (so new_language fires once per
 *   bill per term — the first added-language match; later re-amendments of the
 *   same bill into the same term are not re-fired).
 *
 * Writes ONLY to radar_matches + alert_events + radar_bill_state. Never touches
 * sync, scoring, or the bills write-path. Dedup via the radar_matches UNIQUE
 * (term_id, bill_id, match_reason) constraint keeps re-runs idempotent — a
 * given (term, bill) fires at most once per reason.
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

// Page size for reading/writing radar_bill_state (Supabase 1000-row cap on
// reads; batched writes stay well under any payload limit).
const STATE_PAGE = 1000;

// R6: max multi-version bills diffed per run (newest-change-first). Early in a
// session almost no bill has 2 versions; dedup makes any re-diff a no-op, so a
// modest cap is safe. Override via env.
const TEXT_PAIR_LIMIT = Math.max(1, parseInt(process.env.RADAR_TEXT_PAIR_LIMIT || '200', 10) || 200);

// R6: minimum added-text length to bother matching (skips trivial reformatting
// noise) and the bounded length of the quoted snippet stored + emailed.
const MIN_ADDED_CHARS = 40;
const SNIPPET_MAX = 280;

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

  // 2b. Per-user global Radar switch (Thread R3). When a user has
  // notification_preferences.radar_enabled = false, we still write the
  // radar_matches ledger (so their Radar feed stays live) but suppress the
  // immediate alert_events insert below — no Radar email goes out. A missing
  // prefs row defaults to enabled (matches the column default), so detection
  // is never silently dropped for users who haven't opened Settings yet.
  const radarDisabled = new Set();
  const termUserIds = [...new Set(terms.map(t => t.user_id))];
  if (termUserIds.length > 0) {
    const { data: prefs, error: pErr } = await supabase
      .from('notification_preferences')
      .select('user_id, radar_enabled')
      .in('user_id', termUserIds);
    if (pErr) {
      console.warn('  [radar_enabled lookup failed, defaulting to enabled]:', pErr.message);
    } else {
      for (const p of prefs || []) {
        if (p.radar_enabled === false) radarDisabled.add(p.user_id);
      }
    }
  }

  let totalLedger = 0;
  let totalAlerts = 0;

  // 3. Per-term detection (new-bill pass). 'fulltext'-scope terms are matched
  //    against archived bill text in the dedicated fulltext pass below, so they
  //    are skipped here — their last_checked_at is advanced there instead.
  for (const term of terms) {
    if (term.match_scope === 'fulltext') continue;
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
    // Skip the email path entirely when the owner has Radar turned off in
    // Settings — the ledger rows above already captured the matches for the feed.
    if (term.cadence === 'immediate' && !radarDisabled.has(term.user_id)) {
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
      const why = radarDisabled.has(term.user_id) ? 'Radar off in Settings' : 'digest cadence';
      console.log(`  term ${term.id} "${term.label}": ${fresh.length} new match(es), ledger only (${why}).`);
    }

    // 3e. Advance the watermark only after a fully successful pass.
    await advanceLastChecked(term.id, runStamp);
  }

  // 4. Material-change pass (Phase 2 / Thread R4). Re-matches bills that were
  //    substituted / amended / re-summarized after introduction. Seeds
  //    radar_bill_state silently on the first run (no alert flood).
  const mat = await detectMaterialChanges(terms, clientLabels, radarDisabled);
  totalLedger += mat.ledger;
  totalAlerts += mat.alerts;

  // 5. New-language pass (Phase 3b / Thread R6). Diffs the two most recent
  //    archived text versions and matches the ADDED language per non-title term.
  const lang = await detectNewLanguage(terms, clientLabels, radarDisabled);
  totalLedger += lang.ledger;
  totalAlerts += lang.alerts;

  // 6. Fulltext-scope pass (Phase 3b / Thread R6). Matches 'fulltext' terms
  //    against the latest archived bill text.
  const ft = await detectFulltext(terms, clientLabels, radarDisabled);
  totalLedger += ft.ledger;
  totalAlerts += ft.alerts;

  const duration = Date.now() - start;
  console.log(`Radar detection complete: ${totalLedger} ledger row(s), ${totalAlerts} immediate alert(s) in ${duration}ms.`);
}

// ── Material-change pass (Phase 2) ─────────────────────────

async function loadBillState() {
  const stored = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('radar_bill_state')
      .select('bill_id, amendment_count, substitute_filed, summary_hash, ai_summary_hash')
      .range(from, from + STATE_PAGE - 1);
    if (error) {
      console.warn('  [radar_bill_state read failed]:', error.message);
      break;
    }
    for (const r of data || []) stored.set(r.bill_id, r);
    if (!data || data.length < STATE_PAGE) break;
    from += STATE_PAGE;
  }
  return stored;
}

// Upsert only the rows that actually moved (plus brand-new bills). Writing the
// full 3.4k-row snapshot every run would be needless write churn; we pass in
// just the changed/new rows.
async function upsertBillState(rows) {
  if (!rows || rows.length === 0) return;
  const stamp = new Date().toISOString();
  const payload = rows.map(s => ({
    bill_id: s.bill_id,
    amendment_count: s.amendment_count ?? 0,
    substitute_filed: s.substitute_filed ?? false,
    summary_hash: s.summary_hash,
    ai_summary_hash: s.ai_summary_hash,
    updated_at: stamp,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const batch = payload.slice(i, i + 500);
    const { error } = await supabase
      .from('radar_bill_state')
      .upsert(batch, { onConflict: 'bill_id' });
    if (error) console.warn(`  [radar_bill_state upsert batch ${i} failed]: ${error.message}`);
  }
}

async function detectMaterialChanges(terms, clientLabels, radarDisabled) {
  let ledger = 0;
  let alerts = 0;

  // Live per-bill snapshot (hashes computed server-side via the RPC).
  const { data: snap, error: snapErr } = await supabase.rpc('radar_bill_state_snapshot', {
    p_session: CURRENT_SESSION,
  });
  if (snapErr) {
    console.warn('  [material-change snapshot failed]:', snapErr.message);
    return { ledger, alerts };
  }
  const snapshot = snap || [];

  const stored = await loadBillState();
  const firstRun = stored.size === 0;

  // toPersist = rows to write back (new-to-state on first run, or moved rows).
  // changed   = rows with PRIOR state that materially moved (worth re-matching).
  const toPersist = [];
  const changed = [];

  for (const s of snapshot) {
    const prev = stored.get(s.bill_id);
    if (!prev) {
      // No prior snapshot → seed it, but never treat as a material change. On
      // the first run this is every bill (silent seed); later it's a brand-new
      // bill the new-bill pass already owns.
      toPersist.push(s);
      continue;
    }
    const subFlip = prev.substitute_filed === false && s.substitute_filed === true;
    const amendUp = (s.amendment_count || 0) > (prev.amendment_count || 0);
    const sumChg = s.summary_hash !== prev.summary_hash;
    const aiChg = s.ai_summary_hash !== prev.ai_summary_hash;
    if (subFlip || amendUp || sumChg || aiChg) {
      const kinds = [];
      if (subFlip) kinds.push('substitute');
      if (amendUp) kinds.push('amendment');
      if (sumChg || aiChg) kinds.push('summary');
      changed.push({ bill_id: s.bill_id, kinds });
      toPersist.push(s);
    }
    // unchanged → no write, no match.
  }

  if (firstRun) {
    await upsertBillState(toPersist);
    console.log(`  Material-change pass: seeded radar_bill_state with ${toPersist.length} bill(s) (first run — no material-change alerts).`);
    return { ledger, alerts };
  }

  if (changed.length === 0) {
    await upsertBillState(toPersist); // brand-new bills only (no-op if none)
    console.log('  Material-change pass: no qualifying bill changes.');
    return { ledger, alerts };
  }

  console.log(`  Material-change pass: ${changed.length} bill(s) moved — re-matching against ${terms.length} term(s).`);

  const changedIds = changed.map(c => c.bill_id);
  const kindById = new Map(changed.map(c => [c.bill_id, c.kinds]));

  for (const term of terms) {
    if (term.match_scope === 'fulltext') continue; // fulltext terms re-evaluate latest text every run in their own pass
    const clientLabel = term.client_id ? (clientLabels.get(term.client_id) || null) : null;
    const titleOnly = term.match_scope === 'title';

    const hits = [];
    for (let i = 0; i < changedIds.length; i += 500) {
      const batch = changedIds.slice(i, i + 500);
      const { data: m, error: mErr } = await supabase.rpc('radar_match_bill_ids', {
        p_query: term.query,
        p_title_only: titleOnly,
        p_bill_ids: batch,
      });
      if (mErr) {
        console.warn(`  [term ${term.id} "${term.label}" material match failed]: ${mErr.message}`);
        continue;
      }
      for (const r of m || []) hits.push(r);
    }
    if (hits.length === 0) continue;

    const res = await emitMatches({
      term,
      hits,
      reason: 'material_change',
      clientLabel,
      radarDisabled,
      kindById,
    });
    ledger += res.ledger;
    alerts += res.alerts;
  }

  // Persist state LAST: a mid-run failure then simply retries next run rather
  // than recording the change as "seen" without having fired its matches.
  await upsertBillState(toPersist);

  return { ledger, alerts };
}

// Shared ledger + immediate-alert writer for a (term, matched bills, reason).
// Mirrors the new-bill insert/dedup/cap/backfill logic so the two passes stay
// consistent; the per-term daily_cap is shared across reasons because the
// firedToday count below is reason-agnostic.
async function emitMatches({ term, hits, reason, clientLabel, radarDisabled, kindById, snippetById }) {
  let ledger = 0;
  let alerts = 0;

  // Dedup against existing ledger rows for this (term, reason).
  const hitIds = hits.map(h => h.bill_id);
  const existing = new Set();
  for (let i = 0; i < hitIds.length; i += 500) {
    const batch = hitIds.slice(i, i + 500);
    const { data: seen, error: sErr } = await supabase
      .from('radar_matches')
      .select('bill_id')
      .eq('term_id', term.id)
      .eq('match_reason', reason)
      .in('bill_id', batch);
    if (sErr) console.warn(`  [term ${term.id} ${reason} dedup read failed]: ${sErr.message}`);
    else for (const r of seen || []) existing.add(r.bill_id);
  }

  const fresh = hits.filter(h => !existing.has(h.bill_id));
  if (fresh.length === 0) return { ledger, alerts };

  const ledgerRows = fresh.map(h => ({
    term_id: term.id,
    user_id: term.user_id,
    bill_id: h.bill_id,
    match_reason: reason,
    snippet: snippetById ? (snippetById.get(h.bill_id) || null) : null,
  }));
  const { error: insErr } = await supabase
    .from('radar_matches')
    .upsert(ledgerRows, { onConflict: 'term_id,bill_id,match_reason', ignoreDuplicates: true });
  if (insErr) {
    console.warn(`  [term ${term.id} ${reason} ledger insert failed]: ${insErr.message}`);
    return { ledger, alerts };
  }

  // Read back this run's ledger rows (id + bill_id) for the alert backfill.
  const freshIds = fresh.map(h => h.bill_id);
  const ledgerById = new Map();
  for (let i = 0; i < freshIds.length; i += 500) {
    const batch = freshIds.slice(i, i + 500);
    const { data: rows } = await supabase
      .from('radar_matches')
      .select('id, bill_id, alert_event_id')
      .eq('term_id', term.id)
      .eq('match_reason', reason)
      .in('bill_id', batch);
    for (const r of rows || []) ledgerById.set(r.bill_id, r);
  }
  ledger = fresh.length;

  if (term.cadence === 'immediate' && !radarDisabled.has(term.user_id)) {
    const cap = Number.isFinite(term.daily_cap) ? term.daily_cap : 25;

    const { count: firedToday } = await supabase
      .from('radar_matches')
      .select('id', { count: 'exact', head: true })
      .eq('term_id', term.id)
      .not('alert_event_id', 'is', null)
      .gte('detected_at', startOfUtcTodayISO());

    const remaining = Math.max(0, cap - (firedToday || 0));
    const toAlert = fresh.slice(0, remaining);

    const alertRows = [];
    for (const h of toAlert) {
      const led = ledgerById.get(h.bill_id);
      if (!led || led.alert_event_id) continue;
      alertRows.push({
        bill_id: h.bill_id,
        user_id: term.user_id,
        event_type: 'radar_match',
        event_data: {
          term_id: term.id,
          term_label: term.label,
          client_label: clientLabel,
          query: term.query,
          bill_number: h.bill_number,
          bill_title: h.title,
          match_reason: reason,
          change_kinds: kindById ? (kindById.get(h.bill_id) || []) : undefined,
          snippet: snippetById ? (snippetById.get(h.bill_id) || null) : undefined,
        },
      });
    }

    if (alertRows.length > 0) {
      const { data: inserted, error: aErr } = await supabase
        .from('alert_events')
        .insert(alertRows)
        .select('id, bill_id');
      if (aErr) {
        console.warn(`  [term ${term.id} ${reason} alert_events insert failed]: ${aErr.message}`);
      } else {
        for (const ev of inserted || []) {
          const led = ledgerById.get(ev.bill_id);
          if (!led) continue;
          const { error: upErr } = await supabase
            .from('radar_matches')
            .update({ alert_event_id: ev.id })
            .eq('id', led.id);
          if (upErr) console.warn(`  [term ${term.id} ${reason} backfill failed for ${ev.bill_id}]: ${upErr.message}`);
        }
        alerts = inserted?.length || 0;
      }
    }

    const overflow = fresh.length - toAlert.length;
    console.log(
      `  term ${term.id} "${term.label}": ${fresh.length} ${reason} match(es), ` +
      `${alerts} emailed${overflow > 0 ? `, ${overflow} ledger-only (daily cap ${cap})` : ''}.`
    );
  } else {
    const why = radarDisabled.has(term.user_id) ? 'Radar off in Settings' : 'digest cadence';
    console.log(`  term ${term.id} "${term.label}": ${fresh.length} ${reason} match(es), ledger only (${why}).`);
  }

  return { ledger, alerts };
}

// ── New-language pass (Phase 3b / R6) ──────────────────────
// Diff the two most recent archived text versions of each changed bill (added
// lines only), then re-run each enabled non-title term against just that ADDED
// text. A match fires radar_matches(match_reason='new_language', snippet=...)
// so the alert can quote the language that literally changed.

// Set-based line diff: lines present in the new text but not the previous one.
// WA legislative text is one provision per line after htmlToText normalization,
// so line presence is a good proxy for "newly added language" without a full
// LCS. Whole-bill reflows (rare) just surface more added lines — bounded below.
function addedText(newText, prevText) {
  const prev = new Set(String(prevText || '').split('\n'));
  const out = [];
  for (const line of String(newText || '').split('\n')) {
    const l = line.trim();
    if (l && !prev.has(line)) out.push(l);
  }
  return out.join('\n');
}

// Bounded, word-safe excerpt for the ledger + email quote.
function boundedSnippet(text, max = SNIPPET_MAX) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

async function detectNewLanguage(terms, clientLabels, radarDisabled) {
  let ledger = 0;
  let alerts = 0;

  // Title-only terms care only about the title, so they sit out the body diff.
  const eligible = terms.filter(t => t.match_scope !== 'title');
  if (eligible.length === 0) return { ledger, alerts };

  const { data: pairs, error: pErr } = await supabase.rpc('radar_bill_text_pairs', {
    p_session: CURRENT_SESSION,
    p_limit: TEXT_PAIR_LIMIT,
  });
  if (pErr) {
    console.warn('  [new-language pairs fetch failed]:', pErr.message);
    return { ledger, alerts };
  }
  if (!pairs || pairs.length === 0) {
    console.log('  New-language pass: no bills with 2+ text versions yet.');
    return { ledger, alerts };
  }

  // Pre-compute added text once per changed bill (independent of term).
  const changedBills = [];
  for (const p of pairs) {
    const added = addedText(p.new_text, p.prev_text);
    if (added.length >= MIN_ADDED_CHARS) {
      changedBills.push({ bill_id: p.bill_id, bill_number: p.bill_number, title: p.title, added });
    }
  }
  if (changedBills.length === 0) {
    console.log(`  New-language pass: ${pairs.length} multi-version bill(s), none with material added text.`);
    return { ledger, alerts };
  }

  console.log(`  New-language pass: ${changedBills.length} bill(s) with added language — matching against ${eligible.length} term(s).`);

  for (const term of eligible) {
    const clientLabel = term.client_id ? (clientLabels.get(term.client_id) || null) : null;
    const hits = [];
    const snippetById = new Map();

    for (const b of changedBills) {
      const { data: isMatch, error: mErr } = await supabase.rpc('radar_text_matches', {
        p_query: term.query,
        p_text: b.added,
      });
      if (mErr) {
        console.warn(`  [term ${term.id} "${term.label}" new-language match failed on ${b.bill_id}]: ${mErr.message}`);
        continue;
      }
      if (isMatch === true) {
        hits.push({ bill_id: b.bill_id, bill_number: b.bill_number, title: b.title });
        snippetById.set(b.bill_id, boundedSnippet(b.added));
      }
    }
    if (hits.length === 0) continue;

    const res = await emitMatches({
      term,
      hits,
      reason: 'new_language',
      clientLabel,
      radarDisabled,
      snippetById,
    });
    ledger += res.ledger;
    alerts += res.alerts;
  }

  return { ledger, alerts };
}

// ── Fulltext-scope pass (Phase 3b / R6) ────────────────────
// Terms whose match_scope='fulltext' are matched against the LATEST archived
// bill text (not title/summary). Re-evaluated every run; the (term, bill,
// 'new_bill') dedup means each matching bill fires at most once per term.
async function detectFulltext(terms, clientLabels, radarDisabled) {
  let ledger = 0;
  let alerts = 0;

  const ftTerms = terms.filter(t => t.match_scope === 'fulltext');
  if (ftTerms.length === 0) return { ledger, alerts };

  for (const term of ftTerms) {
    const clientLabel = term.client_id ? (clientLabels.get(term.client_id) || null) : null;

    const { data: hits, error: mErr } = await supabase.rpc('radar_match_fulltext', {
      p_query: term.query,
      p_session: CURRENT_SESSION,
      p_limit: MATCH_FETCH_LIMIT,
    });
    if (mErr) {
      console.warn(`  [term ${term.id} "${term.label}" fulltext match failed]: ${mErr.message}`);
      // Do not advance last_checked_at on failure — retry next run.
      continue;
    }

    if (hits && hits.length > 0) {
      const res = await emitMatches({
        term,
        hits,
        reason: 'new_bill',
        clientLabel,
        radarDisabled,
      });
      ledger += res.ledger;
      alerts += res.alerts;
    } else {
      console.log(`  term ${term.id} "${term.label}": fulltext scope, no current-text matches.`);
    }

    await advanceLastChecked(term.id, new Date().toISOString());
  }

  return { ledger, alerts };
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
