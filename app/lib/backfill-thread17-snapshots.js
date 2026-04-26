/**
 * Thread 17 — One-shot backfill for the 2026-04-25 + 2026-04-26
 * trajectory_snapshots NULL gap caused by the rollCalls ReferenceError
 * in the sync-v2 batch handler (introduced in Thread 6 PR #14).
 *
 * The handler at line 1623 referenced `rollCalls` from outside the
 * scope where it was declared. processBill() returned only
 * { billRecord, scores, amendments }, so the bare `rollCalls` reference
 * threw ReferenceError on every iteration. The catch block swallowed
 * it; the snapshot upsert never ran. The daily-snapshot edge function
 * (9 columns, no sub-scores) became the only writer for 2026-04-25 and
 * 2026-04-26.
 *
 * This script reads bills.* state, calls sync-v2's scoreBill in interim
 * mode (post sine-die), and UPDATEs the existing trajectory_snapshots
 * rows for both target dates with the 8 columns the daily-snapshot
 * function omits. Idempotent — safe to re-run.
 *
 * Usage (PowerShell):
 *   cd $env:USERPROFILE\vector-app
 *   $env:CURRENT_BIENNIUM = '2025-26'
 *   $env:CURRENT_YEAR     = '2026'
 *   # SUPABASE_URL + SUPABASE_SERVICE_KEY from .env.local
 *   node app/lib/backfill-thread17-snapshots.js
 *
 * Companion:
 *   - Memory project_signals_subscore_null_regression_2026_04_26
 *   - BUG_ASSESSMENT_2026-04-26.md Bug #1
 */

const path = require('path');

// Resolve env from whichever .env.local is closer (matches sync-rosters.js).
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
  require('dotenv').config(); // CWD fallback
} catch (_) { /* dotenv optional */ }

const { createClient } = require('@supabase/supabase-js');
// IMPORTANT: scoreBill is the canonical, frozen-engine implementation in
// sync-v2.js. We reuse it here so the backfill values exactly match what
// the nightly sync would have written on 2026-04-25 and 2026-04-26 had
// it not errored out. G5: this script does NOT redefine scoring logic.
const { scoreBill } = require('./sync-v2');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in env or .env.local');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const YEAR    = process.env.CURRENT_YEAR;
const SESSION = YEAR ? `${parseInt(YEAR) - 1}-${YEAR}` : '2025-2026';
const TARGET_DATES = ['2026-04-25', '2026-04-26'];

// Mirrors getHardcodedWeights().category_rates in sync-v2.js (Phase 7D.3
// recalibration — April 2026, 8,062 bills, 3 bienniums). loadCalibratedWeights
// is preferred when available; this is the documented fallback.
const FALLBACK_CATEGORY_RATES = {
  'Natural Resources': 0.358, 'Other': 0.348, 'Employment / Labor': 0.343,
  'Veterans / Military': 0.313, 'Agriculture': 0.286, 'Business / Commerce': 0.267,
  'Health': 0.266, 'Transportation': 0.244, 'Housing': 0.244,
  'Criminal Justice': 0.242, 'Education': 0.235, 'Government Operations': 0.232,
  'Environment': 0.222, 'Technology': 0.192, 'Budget / Appropriations': 0.190,
};

async function loadCategoryRates() {
  const { data } = await supabase
    .from('calibration_weights')
    .select('category_rates')
    .eq('is_current', true)
    .single();
  if (data?.category_rates) {
    console.log('  Loaded calibration_weights.category_rates from DB');
    return data.category_rates;
  }
  console.log('  Using hardcoded fallback category_rates');
  return FALLBACK_CATEGORY_RATES;
}

async function fetchAllBills(session) {
  let bills = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq('session', session)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) {
      console.error('FATAL: bills query failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    bills = bills.concat(data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return bills;
}

async function main() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Thread 17 backfill — ${SESSION} → ${TARGET_DATES.join(', ')}`);

  const categoryRates = await loadCategoryRates();
  const bills = await fetchAllBills(SESSION);
  console.log(`  Loaded ${bills.length} bills`);

  let updated = 0;
  let missing = 0;
  let errors  = 0;

  for (const bill of bills) {
    // Interim mode — 2026-04-25 + 2026-04-26 are both post sine-die.
    // Matches the session_state the live sync would have computed.
    const scores = scoreBill(bill, categoryRates, 'interim');

    for (const date of TARGET_DATES) {
      const { data: rows, error } = await supabase
        .from('trajectory_snapshots')
        .update({
          committee_score:   scores.committee,
          sponsor_score:     scores.sponsor,
          momentum_score:    scores.momentum,
          historical_score:  scores.historical,
          fiscal_score:      scores.fiscal,
          xf_factors:        scores.xf_factors,
          days_since_action: bill.days_since_action,
          fiscal_note_size:  bill.fiscal_note_size,
        })
        .eq('bill_id', bill.bill_id)
        .eq('snapshot_date', date)
        .select('id');

      if (error) {
        errors++;
        console.error(`  ${bill.bill_id} ${date}: ${error.message}`);
      } else if (!rows || rows.length === 0) {
        missing++;
      } else {
        updated += rows.length;
      }
    }
  }

  const dur = Math.round((Date.now() - startTime) / 1000);
  console.log(`  Done: ${updated} snapshot rows updated; ${missing} dates with no existing row; ${errors} errors (${dur}s)`);

  // Drift sentinel — bills * dates expected.
  const expected = bills.length * TARGET_DATES.length;
  if (updated < expected * 0.99) {
    console.warn(`  ⚠ Updated ${updated} of expected ~${expected}. Investigate the ${missing + errors} non-updates above.`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
