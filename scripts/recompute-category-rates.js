/**
 * Phase 7U.4d — Recompute global category_rates
 *
 * Companion to scripts/recompute-bucket-rates.js. That script updated the
 * bucket_pass_rates on the current calibration_weights row but left
 * category_rates as {} (an empty placeholder). This left a footgun:
 * rescore-all.js falls through to the hardcoded 15-category map, which
 * disagrees with the 12-category map that loadCalibratedWeights() returned
 * to the backfill. Result: every historical bill's `historical` sub-score
 * shifts and final_score drifts. Phase 7U.4 is only half-calibrated until
 * category_rates are filled.
 *
 * This script queries bills × category × LAW/DEAD across all 3 biennia,
 * computes empirical pass rates, and UPDATES the current calibration_weights
 * row's category_rates field in place (does NOT create a new row).
 *
 * Writes are idempotent — safe to re-run.
 *
 * Usage:
 *   node scripts/recompute-category-rates.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env.local') }); } catch (e) {}

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[cat-recompute] Supabase credentials missing');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PAGE_SIZE = 1000;

async function fetchAllBills() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, session, category, confidence_label')
      .order('bill_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) { console.error('[cat-recompute] fetch error:', error.message); process.exit(1); }
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function main() {
  console.log('[cat-recompute] Loading all bills...');
  const bills = await fetchAllBills();
  console.log(`[cat-recompute] ${bills.length} bills loaded`);

  // Tally LAW / DEAD per category. Ignore CARRY OVER (indeterminate outcome).
  const cats = {};
  for (const b of bills) {
    const c = b.category || 'Other';
    if (!cats[c]) cats[c] = { law: 0, dead: 0, indeterminate: 0, total: 0 };
    const label = b.confidence_label;
    if (label === 'LAW') { cats[c].law++; cats[c].total++; }
    else if (label === 'DEAD') { cats[c].dead++; cats[c].total++; }
    else { cats[c].indeterminate++; }
  }

  // Compute empirical pass rates
  const category_rates = {};
  const rows = [];
  Object.keys(cats).sort().forEach(c => {
    const s = cats[c];
    const rate = s.total > 0 ? s.law / s.total : 0;
    category_rates[c] = Number(rate.toFixed(4));
    rows.push({ category: c, law: s.law, total: s.total, rate, indeterminate: s.indeterminate });
  });

  // Sort for pretty print (by rate desc)
  rows.sort((a, b) => b.rate - a.rate);

  console.log('\n[cat-recompute] ═══ Empirical category pass rates ═══');
  console.log('  category'.padEnd(28) + 'LAW'.padStart(6) + ' /' + 'total'.padStart(6) + '  rate     (indet)');
  rows.forEach(r => {
    console.log(
      '  ' + r.category.padEnd(26) +
      String(r.law).padStart(6) + ' /' + String(r.total).padStart(6) +
      '  ' + (r.rate * 100).toFixed(1).padStart(5) + '%' +
      '  (' + r.indeterminate + ')'
    );
  });

  // Fetch current calibration row
  const { data: curRows, error: fetchErr } = await supabase
    .from('calibration_weights')
    .select('*')
    .eq('is_current', true)
    .order('id', { ascending: false })
    .limit(1);
  if (fetchErr) { console.error('[cat-recompute] current row fetch error:', fetchErr.message); process.exit(1); }
  if (!curRows || !curRows.length) { console.error('[cat-recompute] no is_current=true row found'); process.exit(1); }
  const current = curRows[0];
  console.log(`\n[cat-recompute] Current calibration row: id=${current.id}, computed_at=${current.computed_at}`);
  console.log(`[cat-recompute] Current category_rates has ${Object.keys(current.category_rates || {}).length} entries`);

  // UPDATE in place
  const { error: upErr } = await supabase
    .from('calibration_weights')
    .update({
      category_rates,
      notes: (current.notes || '') + ' | category_rates filled 2026-04-12 from 3-biennium empirical data',
    })
    .eq('id', current.id);
  if (upErr) { console.error('[cat-recompute] update error:', upErr.message); process.exit(1); }

  console.log(`[cat-recompute] Updated row id=${current.id} with ${Object.keys(category_rates).length} category_rates`);
  console.log('\n[cat-recompute] Reminder: re-run scripts\\rescore-all.js after this to propagate new rates.');
}

main().catch(e => { console.error('[cat-recompute] FATAL:', e); process.exit(1); });
