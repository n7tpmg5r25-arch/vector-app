/**
 * Phase 7U.4c DIAGNOSTIC — Score Drift Investigator
 *
 * After the 2021-2022 dry-run of rescore-all.js, 1,435/2,320 bills (~62%)
 * had final_score changes even though Phase 7U.4 only edited the pass_prob
 * ladder (which doesn't feed back into final_score). This script finds the
 * actual source of drift by running scoreBill() on a sample of bills and
 * printing a per-component diff against the stored values.
 *
 * DOES NOT WRITE. Safe to run any number of times.
 *
 * Usage:
 *   node scripts/diagnose-score-drift.js
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '..', 'app', '.env.local') }); } catch (e) {}

const { scoreBill, getHardcodedWeights } = require('../app/lib/sync-v2');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION = process.env.SESSION_FILTER || '2021-2022';
const SAMPLE_N = parseInt(process.env.SAMPLE_N || '5', 10);

// Use the same category rates the rescore used (hardcoded fallback, because
// the new calibration_weights row has an empty category_rates map).
const CATEGORY_RATES = getHardcodedWeights().category_rates;

async function main() {
  console.log(`[diag] Loading ${SESSION} bills...`);
  const { data: bills, error } = await supabase
    .from('bills')
    .select('*')
    .eq('session', SESSION)
    .order('bill_id', { ascending: true })
    .limit(2500);
  if (error) { console.error('[diag] fetch error:', error.message); process.exit(1); }
  console.log(`[diag] Loaded ${bills.length} bills`);

  const drifted = [];
  for (const bill of bills) {
    const scores = scoreBill(bill, CATEGORY_RATES, 'interim');
    if (!scores) continue;
    if (scores.final_score !== bill.final_score) {
      drifted.push({ bill, scores });
      if (drifted.length >= SAMPLE_N) break;
    }
  }

  console.log(`\n[diag] Found ${drifted.length} drifted bills (stopped at sample cap ${SAMPLE_N})\n`);

  drifted.forEach(({ bill, scores }, i) => {
    console.log(`─── ${i + 1}. ${bill.bill_id} ${'─'.repeat(50)}`);
    console.log(`    title: ${(bill.title || '').slice(0, 70)}`);
    console.log(`    category: ${bill.category}   stage: ${bill.stage}   label: ${bill.confidence_label}`);
    console.log(`    stored  final_score=${bill.final_score}  trajectory=${bill.trajectory_score}  xf=${bill.xf_multiplier}`);
    console.log(`    new     final_score=${scores.final_score}  base_total=${scores.base_total}  xf=${scores.xf_multiplier}`);
    const delta = scores.final_score - bill.final_score;
    console.log(`    DELTA   final_score ${delta >= 0 ? '+' : ''}${delta}`);
    console.log(`    new sub-scores: committee=${scores.committee} sponsor=${scores.sponsor} momentum=${scores.momentum} historical=${scores.historical} fiscal=${scores.fiscal}`);
    console.log(`    new xf_factors (${scores.xf_factors.length}):`);
    scores.xf_factors.forEach(f => console.log(`        ${f.pos ? '+' : ' '}${f.d.toFixed(2)}  ${f.l}`));
    // Relevant inputs
    console.log(`    inputs:`);
    console.log(`        has_public_hearing=${bill.has_public_hearing}  committee_passed=${bill.committee_passed}  has_executive_session=${bill.has_executive_session}`);
    console.log(`        majority_sponsor=${bill.majority_sponsor}  bipartisan=${bill.bipartisan}  is_committee_chair=${bill.is_committee_chair}  cosponsor_count=${bill.cosponsor_count}`);
    console.log(`        substitute_filed=${bill.substitute_filed}  pulled_from_rules=${bill.pulled_from_rules}  stalled=${bill.stalled}  held_in_rules=${bill.held_in_rules}`);
    console.log(`        double_referral=${bill.double_referral}  fiscal_referral=${bill.fiscal_referral}  amendment_count=${bill.amendment_count}`);
    console.log(`        companion_bill=${bill.companion_bill}  avg_floor_margin=${bill.avg_floor_margin}  fiscal_note_size=${bill.fiscal_note_size}`);
    console.log(`        days_since_action=${bill.days_since_action}  days_to_cutoff=${bill.days_to_cutoff}`);
    console.log('');
  });

  // Global drift distribution
  let stableN = 0, driftN = 0;
  const deltas = [];
  for (const bill of bills) {
    const scores = scoreBill(bill, CATEGORY_RATES, 'interim');
    if (!scores) continue;
    const d = scores.final_score - bill.final_score;
    if (d === 0) stableN++;
    else { driftN++; deltas.push(d); }
  }
  deltas.sort((a, b) => a - b);
  const mean = deltas.reduce((s, x) => s + x, 0) / (deltas.length || 1);
  const median = deltas[Math.floor(deltas.length / 2)] || 0;
  const min = deltas[0] || 0;
  const max = deltas[deltas.length - 1] || 0;

  console.log('─── Drift distribution ───');
  console.log(`  stable:   ${stableN}`);
  console.log(`  drifted:  ${driftN}`);
  console.log(`  delta min=${min}  max=${max}  mean=${mean.toFixed(2)}  median=${median}`);

  // Histogram of deltas
  const buckets = { '<-10': 0, '-10..-6': 0, '-5..-1': 0, '0': stableN, '+1..+5': 0, '+6..+10': 0, '>+10': 0 };
  deltas.forEach(d => {
    if (d < -10) buckets['<-10']++;
    else if (d <= -6) buckets['-10..-6']++;
    else if (d < 0) buckets['-5..-1']++;
    else if (d <= 5) buckets['+1..+5']++;
    else if (d <= 10) buckets['+6..+10']++;
    else buckets['>+10']++;
  });
  console.log('  histogram:');
  Object.entries(buckets).forEach(([k, v]) => console.log(`    ${k.padEnd(10)} ${v}`));
}

main().catch(e => { console.error('[diag] FATAL:', e); process.exit(1); });
