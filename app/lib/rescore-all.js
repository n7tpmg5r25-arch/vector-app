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

// ── PHASE 7W.2: COMPANION STATE WEIGHTS ──────────────────────────────────────
// Mirrors sync-v2.js COMPANION_XF_WEIGHTS exactly. Keep in sync — if you edit
// the weights in one place, edit them in the other and run rescore-all.js.
// These weights are intuition, not calibration; Phase 7U must recalibrate them
// against historical 2021-22 / 2023-24 pair outcomes.
const COMPANION_XF_WEIGHTS = {
  both_moving: { l: 'Companion both moving',          d:  0.15 },
  leading:     { l: 'Companion leading (this bill)',  d:  0.08 },
  trailing:    { l: 'Companion leading (other chamber)', d: 0.05 },
  forked:      { l: 'Companion divergence risk',      d: -0.05 },
  both_stuck:  { l: 'Companion both stuck',           d:  0.02 },
};

// ── CALIBRATED RATES (full biennium April 8, 2026 — 3,411 bills, 196 LAW) ──
const BUCKET_RATES = {
  '0-30': 0.000, '30-45': 0.000, '45-60': 0.000,
  '60-75': 0.013, '75-100': 0.694,
};

const CATEGORY_RATES = {
  'Natural Resources': 0.195, 'Government Operations': 0.098, 'Agriculture': 0.098,
  'Employment / Labor': 0.096, 'Transportation': 0.092, 'Veterans / Military': 0.070,
  'Business / Commerce': 0.068, 'Health': 0.062, 'Environment': 0.054,
  'Housing': 0.052, 'Budget / Appropriations': 0.046, 'Other': 0.045,
  'Criminal Justice': 0.044, 'Technology': 0.036, 'Education': 0.034,
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

  // Phase 7W.2: state-aware companion X-factor (5 states instead of flat +0.10)
  if (bill.companion_bill && bill.companion_state) {
    const cxf = COMPANION_XF_WEIGHTS[bill.companion_state];
    if (cxf && cxf.d !== 0) {
      xf += cxf.d;
      xf_factors.push({ l: cxf.l, d: cxf.d, pos: cxf.d > 0 });
    }
  } else if (bill.companion_bill) {
    // Companion exists but state not yet resolved — neutral fallback
    xf += 0.05;
    xf_factors.push({ l: 'Companion (unresolved)', d: 0.05, pos: true });
  }
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

  // CONFIDENCE — aligned with sync-v2.4 (recalibrated full biennium April 6, 2026)
  // 6A.5: Also compute signal_tier (always score-based, regardless of session state)
  let pass_prob, conf_label, conf_low, conf_high;

  // Score-based signal tier (stored separately from outcome labels)
  let signal_tier;
  if (final_score >= 75) signal_tier = 'HIGH';
  else if (final_score >= 60) signal_tier = 'MODERATE';
  else if (final_score >= 45) signal_tier = 'LOW';
  else signal_tier = 'VERY LOW';

  // Session-state aware confidence labels (matches sync-v2.4 exactly)
  // For rescore-all, we're always running post-session, so treat as interim
  if (bill.stage >= 6) {
    pass_prob = 1.000; conf_label = 'LAW'; conf_low = 1.000; conf_high = 1.000;
  } else if (bill.stage >= 4) {
    // Passed at least one chamber but biennium is over — these bills are done
    pass_prob = 0.000; conf_label = 'CARRY OVER'; conf_low = 0.000; conf_high = 0.000;
  } else if (bill.stalled || bill.held_in_rules) {
    pass_prob = 0.000; conf_label = 'DEAD'; conf_low = 0.000; conf_high = 0.000;
  } else if (bill.stage < 4) {
    pass_prob = 0.000; conf_label = 'DEAD'; conf_low = 0.000; conf_high = 0.000;
  } else {
    pass_prob = 0.000; conf_label = 'VERY LOW'; conf_low = 0.000; conf_high = 0.005;
  }

  return {
    committee, sponsor, momentum, historical, fiscal,
    base_total, xf_multiplier: xf, final_score, xf_factors,
    pass_prob, conf_label, conf_low, conf_high, signal_tier,
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
            signal_tier: scores.signal_tier,
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
    notes: 'rescore-all: Phase 7W.2 companion state weights',
  });
}

main().catch(console.error);
