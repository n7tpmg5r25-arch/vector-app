/**
 * Phase 7U.4 — Re-score All Bills
 *
 * Iterates the `bills` table and re-applies sync-v2's scoreBill() with the
 * current formula. Writes back final_score, pass_probability, confidence_label,
 * confidence_low/high, signal_tier, xf_multiplier.
 *
 * Does NOT hit the WSL API. Does NOT create new trajectory_snapshots.
 * The existing baseline snapshots stay pinned to their sine die dates;
 * sync-v2 will append fresh snapshots going forward with the new formula.
 *
 * Terminal labels (LAW / DEAD / CARRY OVER) are preserved — those are truth
 * for concluded biennia and should not be overwritten by a formula change.
 * Only non-terminal labels (HIGH / MODERATE / LOW / VERY LOW) get replaced.
 *
 * Usage:
 *   node scripts/rescore-all.js                        # all sessions
 *   SESSION_FILTER=2025-2026 node scripts/rescore-all.js  # single session
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env.local') }); } catch (e) {}

// Force interim state so scoreBill applies end-of-session labeling for all
// historical bills. This is SAFE because:
//   - LAW bills (stage 6) get LAW in interim mode     → preserved
//   - DEAD bills (stage <4) get DEAD in interim mode  → preserved
//   - CARRY OVER bills get CARRY OVER in interim mode → preserved for 2025-26
//
// For 2025-2026, today (2026-04-11) is already past sine die (2026-03-12)
// so this is consistent with live sync behavior anyway.
const SESSION_STATE = 'interim';

const { scoreBill, loadCalibratedWeights, getHardcodedWeights } = require('../app/lib/sync-v2');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[rescore] Supabase credentials missing');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_FILTER = process.env.SESSION_FILTER || null;
const PAGE_SIZE = 500;

const TERMINAL_LABELS = new Set(['LAW', 'DEAD', 'CARRY OVER']);

function computeSignalTier(final_score) {
  if (final_score >= 75) return 'HIGH';
  if (final_score >= 60) return 'MODERATE';
  if (final_score >= 45) return 'LOW';
  return 'VERY LOW';
}

// Historical biennia: relabel fresh CARRY OVER → DEAD
function isHistoricalBiennium(session) {
  return session === '2021-2022' || session === '2023-2024';
}

async function fetchAllBills() {
  const all = [];
  let page = 0;
  while (true) {
    let q = supabase
      .from('bills')
      .select('*')
      .order('bill_id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (SESSION_FILTER) q = q.eq('session', SESSION_FILTER);
    const { data, error } = await q;
    if (error) { console.error('[rescore] fetch error:', error.message); process.exit(1); }
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

async function main() {
  const t0 = Date.now();
  console.log('[rescore] ─────────────────────────────────────────');
  console.log(`[rescore] Filter: ${SESSION_FILTER || 'ALL SESSIONS'}`);
  console.log('[rescore] ─────────────────────────────────────────');

  let calibration;
  try { calibration = await loadCalibratedWeights(); }
  catch (e) { calibration = getHardcodedWeights(); }
  // Phase 7U.4: the new calibration row ships with category_rates={} as a
  // placeholder (to be filled by a later job), so check for empty-object too.
  // Without this check, {} || fallback returns {} and every category lookup
  // silently returns undefined, shifting every bill's final_score.
  const calRates = calibration && calibration.category_rates;
  const categoryRates = (calRates && Object.keys(calRates).length > 0)
    ? calRates
    : getHardcodedWeights().category_rates;
  console.log(`[rescore] Using ${Object.keys(categoryRates).length} category rates (source: ${(calRates && Object.keys(calRates).length > 0) ? 'calibration_weights' : 'hardcoded fallback'})`);

  const bills = await fetchAllBills();
  console.log(`[rescore] Loaded ${bills.length} bills`);

  const stats = { updated: 0, unchanged: 0, errors: 0, label_changes: 0, score_changes: 0 };
  const sample = [];

  const WRITE_BATCH = 50;
  const updates = [];

  async function flushUpdates() {
    if (!updates.length) return;
    // Supabase doesn't support batch UPDATE with varying values; use Promise.all
    const results = await Promise.all(updates.map(u =>
      supabase.from('bills').update(u.patch).eq('bill_id', u.bill_id)
    ));
    results.forEach(r => { if (r.error) stats.errors++; });
    updates.length = 0;
  }

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    try {
      const scores = scoreBill(bill, categoryRates, SESSION_STATE);
      if (!scores) { stats.errors++; continue; }

      const oldScore = bill.final_score;
      const oldLabel = bill.confidence_label;
      const oldPass  = bill.pass_probability;

      // scoreBill returned: { committee, sponsor, momentum, historical, fiscal,
      //   base_total, xf_multiplier, final_score, xf_factors,
      //   pass_prob, conf_label, conf_low, conf_high }
      let newLabel = scores.conf_label;
      let newPass  = scores.pass_prob;
      let newLow   = scores.conf_low;
      let newHigh  = scores.conf_high;

      // Historical biennium: relabel fresh CARRY OVER → DEAD
      if (newLabel === 'CARRY OVER' && isHistoricalBiennium(bill.session)) {
        newLabel = 'DEAD';
        newPass  = 0;
        newLow   = 0;
        newHigh  = 0;
      }

      // Preserve existing terminal labels (never demote LAW/DEAD via formula)
      if (TERMINAL_LABELS.has(oldLabel)) {
        newLabel = oldLabel;
        newPass  = oldPass;
        newLow   = bill.confidence_low;
        newHigh  = bill.confidence_high;
      }

      const patch = {
        final_score:      scores.final_score,
        trajectory_score: scores.base_total,
        xf_multiplier:    scores.xf_multiplier,
        pass_probability: newPass,
        confidence_label: newLabel,
        confidence_low:   newLow,
        confidence_high:  newHigh,
        signal_tier:      computeSignalTier(scores.final_score),
        updated_at:       new Date().toISOString(),
      };

      const changed = oldScore !== scores.final_score || oldLabel !== newLabel;
      if (!changed) { stats.unchanged++; continue; }

      if (oldScore !== scores.final_score) stats.score_changes++;
      if (oldLabel !== newLabel) {
        stats.label_changes++;
        if (sample.length < 20) {
          sample.push({
            bill_id: bill.bill_id,
            score: `${oldScore} → ${scores.final_score}`,
            label: `${oldLabel} → ${newLabel}`,
          });
        }
      }

      updates.push({ bill_id: bill.bill_id, patch });
      stats.updated++;

      if (updates.length >= WRITE_BATCH) await flushUpdates();
    } catch (e) {
      stats.errors++;
    }

    if ((i + 1) % 500 === 0) {
      console.log(`[rescore] progress: ${i + 1}/${bills.length} (${stats.updated} updated)`);
    }
  }
  await flushUpdates();

  const dur = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('\n[rescore] ═════════════════════════════════════');
  console.log(`[rescore] Total bills:      ${bills.length}`);
  console.log(`[rescore] Updated:          ${stats.updated}`);
  console.log(`[rescore] Score changes:    ${stats.score_changes}`);
  console.log(`[rescore] Label changes:    ${stats.label_changes}`);
  console.log(`[rescore] Unchanged:        ${stats.unchanged}`);
  console.log(`[rescore] Errors:           ${stats.errors}`);
  console.log(`[rescore] Duration:         ${dur}s`);
  console.log('[rescore] ═════════════════════════════════════');

  if (sample.length) {
    console.log('[rescore] sample label changes:');
    sample.forEach(c => console.log(`  ${c.bill_id}  score ${c.score}  label ${c.label}`));
  }

  process.exit(stats.errors > bills.length * 0.05 ? 1 : 0);
}

main().catch(e => { console.error('[rescore] FATAL:', e); process.exit(1); });
