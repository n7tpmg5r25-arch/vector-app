/**
 * Phase 7U.4 — Recompute global bucket_pass_rates
 *
 * Queries the bills table for final_score buckets × LAW outcome across all
 * biennia in the table (expected: 2021-2022, 2023-2024, 2025-2026) and
 * computes empirical pass rates.
 *
 * Writes a new row into calibration_weights with is_current=true, flips the
 * previous is_current row to false, and prints a JS block ready to paste
 * into sync-v2.js scoreBill() replacing the hardcoded pass_prob values.
 * The old 2025-26-only values are preserved in a reference comment.
 *
 * Usage:
 *   node scripts/recompute-bucket-rates.js
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
  console.error('[recompute] Supabase credentials missing');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Score buckets: match sync-v2.js scoreBill's tiers (75+, 60-74, 45-59, <45)
const BUCKETS = [
  { name: '0-44',   min: 0,  max: 44  },
  { name: '45-59',  min: 45, max: 59  },
  { name: '60-74',  min: 60, max: 74  },
  { name: '75-100', min: 75, max: 100 },
];

const PAGE_SIZE = 1000;

async function fetchAllScoredBills() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, session, final_score, confidence_label')
      .order('bill_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) { console.error('[recompute] fetch error:', error.message); process.exit(1); }
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function main() {
  console.log('[recompute] Loading all bills from all sessions...');
  const bills = await fetchAllScoredBills();
  console.log(`[recompute] ${bills.length} bills loaded`);

  // Session breakdown
  const bySession = {};
  bills.forEach(b => {
    bySession[b.session] = (bySession[b.session] || 0) + 1;
  });
  console.log('[recompute] session counts:');
  Object.keys(bySession).sort().forEach(s => console.log(`  ${s}: ${bySession[s]}`));
  const sessions_used = Object.keys(bySession).sort();

  // Bucket + outcome tally (only count LAW / DEAD — CARRY OVER is indeterminate)
  const buckets = {};
  BUCKETS.forEach(b => {
    buckets[b.name] = { total: 0, law: 0, dead: 0, indeterminate: 0, rate: 0 };
  });

  for (const bill of bills) {
    const score = bill.final_score || 0;
    const bucket = BUCKETS.find(b => score >= b.min && score <= b.max);
    if (!bucket) continue;
    const slot = buckets[bucket.name];
    const label = bill.confidence_label;
    if (label === 'LAW') {
      slot.total++; slot.law++;
    } else if (label === 'DEAD') {
      slot.total++; slot.dead++;
    } else {
      slot.indeterminate++;
    }
  }

  // Compute empirical rates
  const bucket_pass_rates = {};
  BUCKETS.forEach(b => {
    const s = buckets[b.name];
    s.rate = s.total > 0 ? s.law / s.total : 0;
    bucket_pass_rates[b.name] = Number(s.rate.toFixed(4));
  });

  console.log('\n[recompute] ═══ Global bucket pass rates ═══');
  BUCKETS.forEach(b => {
    const s = buckets[b.name];
    console.log(`  ${b.name.padEnd(8)} LAW ${String(s.law).padStart(5)} / ${String(s.total).padStart(5)} = ${(s.rate * 100).toFixed(1)}%  (indeterminate: ${s.indeterminate})`);
  });

  // Flip current row to is_current=false
  console.log('\n[recompute] Flipping existing calibration_weights.is_current → false');
  const { error: flipErr } = await supabase
    .from('calibration_weights')
    .update({ is_current: false })
    .eq('is_current', true);
  if (flipErr) { console.error('[recompute] flip error:', flipErr.message); process.exit(1); }

  // Insert new calibration row
  const newRow = {
    computed_at: new Date().toISOString(),
    lambda_session: 0.5,
    lambda_snapshot: 0.5,
    sessions_used,
    category_rates: {},  // filled by a separate job; keep {} placeholder
    bucket_pass_rates,
    is_current: true,
    notes: `Phase 7U.4 — recomputed across ${sessions_used.join(', ')} (${bills.length} bills)`,
  };
  const { error: insErr, data: insData } = await supabase
    .from('calibration_weights')
    .insert(newRow)
    .select();
  if (insErr) { console.error('[recompute] insert error:', insErr.message); process.exit(1); }
  console.log(`[recompute] new calibration_weights row inserted: id=${insData && insData[0] && insData[0].id}`);

  // Print JS patch block for sync-v2.js
  const p75 = bucket_pass_rates['75-100'];
  const p60 = bucket_pass_rates['60-74'];
  const p45 = bucket_pass_rates['45-59'];
  const p0  = bucket_pass_rates['0-44'];

  console.log('\n[recompute] ════════════════════════════════════════════════════');
  console.log('[recompute] PASTE INTO sync-v2.js scoreBill() pass_prob ladder:');
  console.log('[recompute] (replace the existing 0.694 / 0.013 / 0.008 block)');
  console.log('[recompute] ════════════════════════════════════════════════════');
  console.log(`
  // Phase 7U.4 — 3-biennium empirical pass rates
  // Reference (2025-26 only, pre-7U.4): 75+ = 0.694, 60+ = 0.013, 45+ = 0.008
  // Sessions used: ${sessions_used.join(', ')}
  let pass_prob;
  let confidence_label;
  if (final_score >= 75) {
    pass_prob = ${p75.toFixed(4)};
    confidence_label = 'HIGH';
  } else if (final_score >= 60) {
    pass_prob = ${p60.toFixed(4)};
    confidence_label = 'MODERATE';
  } else if (final_score >= 45) {
    pass_prob = ${p45.toFixed(4)};
    confidence_label = 'LOW';
  } else {
    pass_prob = ${p0.toFixed(4)};
    confidence_label = 'VERY LOW';
  }
`);
  console.log('[recompute] ════════════════════════════════════════════════════');
}

main().catch(e => { console.error('[recompute] FATAL:', e); process.exit(1); });
