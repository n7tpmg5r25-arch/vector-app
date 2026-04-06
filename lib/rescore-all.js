/**
 * VECTOR | WA — Re-Score All Bills
 * lib/rescore-all.js
 *
 * Re-runs the scoring engine on all bills using data already in Supabase.
 * Does NOT call the WSL API — only reads from and writes to the database.
 *
 * Run this AFTER backfill-data-gaps.js to incorporate new data into scores.
 * Can also be run from Cowork (no external API calls needed).
 *
 * Usage:
 *   node lib/rescore-all.js
 *
 * Requires .env with:
 *   SUPABASE_URL=https://skuedssejrbrxycgdcfw.supabase.co
 *   SUPABASE_SERVICE_KEY=your-service-key
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SESSION = '2025-2026';

// ── CALIBRATED RATES (from April 2, 2026 recalibration) ─────────────────────
const BUCKET_RATES = {
  '0-30': 0.000, '30-45': 0.000, '45-60': 0.008,
  '60-75': 0.051, '75-100': 0.293,
};

const CATEGORY_RATES = {
  'Transportation': 0.090, 'Technology': 0.068, 'Agriculture': 0.063,
  'Health': 0.054, 'Employment / Labor': 0.051, 'Other': 0.045,
  'Housing': 0.042, 'Environment': 0.041, 'Business / Commerce': 0.034,
  'Criminal Justice': 0.026, 'Education': 0.025, 'Budget / Appropriations': 0.000,
};

// ── SCORING ENGINE (same as sync-v2.js) ─────────────────────────────────────
function scoreBill(bill) {
  // COMMITTEE (0-25)
  let committee = 3;
  if (bill.has_public_hearing) committee += 11;
  if (bill.committee_passed) committee += 8;
  if (bill.has_executive_session && bill.committee_passed) committee += 6;
  committee = Math.max(0, Math.min(committee, 25));

  // SPONSOR (0-20)
  let sponsor = 4;
  if (bill.majority_sponsor) sponsor += 4;
  if (bill.is_committee_chair) sponsor += 6;
  if (bill.bipartisan) sponsor += 4;
  if ((bill.cosponsor_count || 0) >= 5) sponsor += 2;
  sponsor = Math.max(0, Math.min(sponsor, 20));

  // MOMENTUM (0-20)
  let momentum = 0;
  if (bill.stage >= 4) momentum += 5;
  else if (bill.committee_passed && bill.has_executive_session) momentum += 5;
  else if (bill.has_public_hearing && bill.committee_passed) momentum += 4;
  else if (bill.has_public_hearing) momentum += 3;
  else if (bill.has_executive_session) momentum += 3;
  if (bill.substitute_filed) momentum += 3;
  if (bill.pulled_from_rules) momentum += 3;
  const days = bill.days_since_action || 0;
  if (days <= 7) momentum += 5;
  else if (days <= 14) momentum += 3;
  else if (days <= 21) momentum += 1;
  if (bill.stalled) momentum -= 8;
  momentum = Math.max(0, Math.min(momentum, 20));

  // HISTORICAL (0-20)
  const catRate = CATEGORY_RATES[bill.category] ?? 0.045;
  const baseline = CATEGORY_RATES['Other'] ?? 0.045;
  let historical = Math.round(8 + ((catRate - baseline) / Math.max(baseline, 0.001)) * 10);
  const bn = parseInt((bill.bill_number || '').replace(/\D/g, '')) || 9999;
  if (bn <= 200) historical += 2;
  else if (bn > 600) historical -= 1;
  historical = Math.max(0, Math.min(historical, 20));

  // FISCAL (0-15)
  const fiscalMap = { 'none': 15, 'small': 12, 'medium': 8, 'large': 4, 'very large': 1 };
  const fiscal = fiscalMap[bill.fiscal_note_size] ?? 8;

  // STAGE BONUS
  const stageBonus = { 1: 0, 2: 3, 3: 8, 4: 15, 5: 20, 6: 25 };
  const bonus = stageBonus[bill.stage] ?? 0;

  const base_total = committee + sponsor + momentum + historical + fiscal + bonus;

  // X FACTORS
  let xf = 1.0;
  const xf_factors = [];

  if (bill.companion_bill) { xf += 0.10; xf_factors.push({ l: 'Companion bill', d: 0.10, pos: true }); }
  if (bill.substitute_filed) { xf += 0.05; xf_factors.push({ l: 'Substitute filed', d: 0.05, pos: true }); }
  if (bill.has_executive_session && bill.committee_passed) { xf += 0.06; xf_factors.push({ l: 'Exec session passed', d: 0.06, pos: true }); }
  if ((bill.stage || 1) >= 4) { xf += 0.08; xf_factors.push({ l: '2nd chamber', d: 0.08, pos: true }); }
  if (bill.pulled_from_rules) { xf += 0.15; xf_factors.push({ l: 'Pulled from Rules', d: 0.15, pos: true }); }
  if (bill.avg_floor_margin != null && bill.avg_floor_margin >= 0.75) {
    xf += 0.08; xf_factors.push({ l: 'Strong margin', d: 0.08, pos: true });
  }

  if (bill.double_referral) { xf -= 0.08; xf_factors.push({ l: 'Double referral', d: -0.08, pos: false }); }
  if ((bill.amendment_count || 0) > 3) { xf -= 0.05; xf_factors.push({ l: 'High amendments', d: -0.05, pos: false }); }
  if (bill.fiscal_referral) { xf -= 0.06; xf_factors.push({ l: 'Fiscal referral', d: -0.06, pos: false }); }
  if (bill.stalled) { xf -= 0.10; xf_factors.push({ l: 'Stalled', d: -0.10, pos: false }); }
  if (bill.held_in_rules) { xf -= 0.20; xf_factors.push({ l: 'Held in Rules', d: -0.20, pos: false }); }
  if (!bill.majority_sponsor && !bill.bipartisan) {
    xf -= 0.10; xf_factors.push({ l: 'Minority only', d: -0.10, pos: false });
  }
  if (bill.avg_floor_margin != null && bill.avg_floor_margin < 0.60) {
    xf -= 0.06; xf_factors.push({ l: 'Narrow margin', d: -0.06, pos: false });
  }

  // Cutoff pressure (only during active session)
  const dtc = bill.days_to_cutoff ?? 99;
  if (dtc >= 1 && dtc <= 5 && !bill.has_public_hearing && (bill.stage || 1) <= 2) {
    xf -= 0.18; xf_factors.push({ l: `Cutoff: ${dtc}d`, d: -0.18, pos: false });
  } else if (dtc >= 1 && dtc <= 14 && !bill.committee_passed && (bill.stage || 1) <= 2) {
    xf -= 0.08; xf_factors.push({ l: 'Cutoff warning', d: -0.08, pos: false });
  }

  xf = Math.round(Math.max(0.50, Math.min(1.50, xf)) * 1000) / 1000;
  const final_score = Math.min(99, Math.round(base_total * xf));

  // CONFIDENCE — calibrated to actual 2025-26 outcomes
  let pass_prob, conf_label, conf_low, conf_high;
  if (bill.stalled || bill.held_in_rules) {
    pass_prob = 0.01; conf_label = 'VERY LOW'; conf_low = 0.00; conf_high = 0.03;
  } else if (final_score >= 75) {
    pass_prob = 0.293; conf_label = 'HIGH'; conf_low = 0.220; conf_high = 0.370;
  } else if (final_score >= 60) {
    pass_prob = 0.051; conf_label = 'MODERATE'; conf_low = 0.030; conf_high = 0.075;
  } else if (final_score >= 45) {
    pass_prob = 0.008; conf_label = 'LOW'; conf_low = 0.002; conf_high = 0.020;
  } else if (final_score >= 30) {
    pass_prob = 0.000; conf_label = 'VERY LOW'; conf_low = 0.000; conf_high = 0.005;
  } else {
    pass_prob = 0.000; conf_label = 'VERY LOW'; conf_low = 0.000; conf_high = 0.005;
  }

  return {
    committee, sponsor, momentum, historical, fiscal,
    base_total, xf_multiplier: xf, final_score, xf_factors,
    pass_prob, conf_label, conf_low, conf_high,
  };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  console.log(`[${new Date().toISOString()}] Re-scoring all ${SESSION} bills`);

  // Fetch ALL bills (paginate past Supabase's 1000-row default limit)
  let bills = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('*')
      .eq('session', SESSION)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { console.error('DB error:', error.message); return; }
    if (!data || data.length === 0) break;
    bills = bills.concat(data);
    page++;
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  Loaded ${bills.length} bills (${page} pages)`);

  let updated = 0, snapshotsWritten = 0;
  const errors = [];
  const BATCH = 50;

  for (let i = 0; i < bills.length; i += BATCH) {
    const batch = bills.slice(i, i + BATCH);
    process.stdout.write(`  Scoring ${i}–${Math.min(i + BATCH, bills.length)} of ${bills.length}...\r`);

    for (const bill of batch) {
      try {
        const scores = scoreBill(bill);

        // Update bills table
        const { error: uErr } = await supabase
          .from('bills')
          .update({
            trajectory_score: scores.base_total,
            final_score: scores.final_score,
            xf_multiplier: scores.xf_multiplier,
            pass_probability: scores.pass_prob,
            confidence_label: scores.conf_label,
            confidence_low: scores.conf_low,
            confidence_high: scores.conf_high,
          })
          .eq('bill_id', bill.bill_id);

        if (uErr) { errors.push({ bill: bill.bill_number, err: uErr.message }); continue; }

        // Write trajectory snapshot
        const { error: sErr } = await supabase
          .from('trajectory_snapshots')
          .upsert({
            bill_id: bill.bill_id,
            session: SESSION,
            score: scores.final_score,
            base_total: scores.base_total,
            xf_multiplier: scores.xf_multiplier,
            stage: bill.stage,
            committee_score: scores.committee,
            sponsor_score: scores.sponsor,
            momentum_score: scores.momentum,
            historical_score: scores.historical,
            fiscal_score: scores.fiscal,
            pass_probability: scores.pass_prob,
            confidence_label: scores.conf_label,
            xf_factors: scores.xf_factors,
            snapshot_date: today,
          }, { onConflict: 'bill_id,snapshot_date' });

        if (!sErr) snapshotsWritten++;
        else errors.push({ bill: bill.bill_number, err: `snap: ${sErr.message}` });
        updated++;
      } catch (e) {
        errors.push({ bill: bill.bill_number, err: e.message });
      }
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n  Done: ${updated} bills updated, ${snapshotsWritten} snapshots, ${errors.length} errors (${duration}s)`);
  if (errors.length > 0) {
    console.log('  First 5 errors:', errors.slice(0, 5));
  }

  // Log the sync
  await supabase.from('sync_log').insert({
    session: SESSION,
    bills_fetched: bills.length,
    bills_updated: updated,
    snapshots_written: snapshotsWritten,
    errors: errors.length ? errors.slice(0, 50) : null,
    duration_ms: Date.now() - startTime,
    notes: 'rescore-all: Phase 1.6 + Phase 2 recalibrated rates',
  });
}

main().catch(console.error);
