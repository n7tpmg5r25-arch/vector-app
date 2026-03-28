require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const state = getSessionState();

  // Only run during interim — skip during active session
  if (state !== 'interim') {
    return res.json({ skipped:true, reason:`Session state: ${state}` });
  }

  const COMPLETED_SESSION = '2025-2026';
  const results = {};

  // ── 1. Sponsor velocity by category ─────────────────────────────────────────
  const { data:sponsorData } = await supabase
    .from('bills')
    .select('prime_sponsor,prime_party,category,final_score,stage,sponsor_tier')
    .eq('session', COMPLETED_SESSION)
    .not('final_score','is',null);

  if (sponsorData) {
    const sponsorMap = {};
    for (const b of sponsorData) {
      const key = b.prime_sponsor;
      if (!sponsorMap[key]) sponsorMap[key] = {
        name:b.prime_sponsor, party:b.prime_party,
        tier:b.sponsor_tier, bills:0, avg_score:0,
        passed:0, categories:{},
      };
      const s = sponsorMap[key];
      s.bills++;
      s.avg_score = ((s.avg_score*(s.bills-1)) + (b.final_score||0)) / s.bills;
      if (b.stage >= 4) s.passed++;
      s.categories[b.category] = (s.categories[b.category]||0)+1;
    }
    // Top 30 by avg score
    results.top_sponsors = Object.values(sponsorMap)
      .filter(s => s.bills >= 3)
      .sort((a,b) => b.avg_score - a.avg_score)
      .slice(0,30);
  }

  // ── 2. Category pass rates ───────────────────────────────────────────────────
  const { data:catData } = await supabase
    .from('bills')
    .select('category,stage,outcome_passed_chamber')
    .eq('session', COMPLETED_SESSION);

  if (catData) {
    const catMap = {};
    for (const b of catData) {
      if (!catMap[b.category]) catMap[b.category] = {total:0,passed:0};
      catMap[b.category].total++;
      if (b.outcome_passed_chamber) catMap[b.category].passed++;
    }
    results.category_rates = Object.entries(catMap).map(([cat,s])=>({
      category:cat,
      total:s.total,
      passed:s.passed,
      rate: s.total > 0 ? Math.round((s.passed/s.total)*1000)/1000 : 0,
    })).sort((a,b)=>b.rate-a.rate);
  }

  // ── 3. Signal lift validation ────────────────────────────────────────────────
  const signals = [
    'has_public_hearing','committee_passed','pulled_from_rules',
    'bipartisan','majority_sponsor','substitute_filed',
    'double_referral','held_in_rules','stalled',
  ];

  const { data:signalData } = await supabase
    .from('bills')
    .select(`outcome_passed_chamber,${signals.join(',')}`)
    .eq('session', COMPLETED_SESSION)
    .not('outcome_passed_chamber','is',null);

  if (signalData) {
    results.signal_lifts = {};
    const baseRate = signalData.filter(b=>b.outcome_passed_chamber).length
      / signalData.length;

    for (const sig of signals) {
      const trueB  = signalData.filter(b=>b[sig]===true);
      const falseB = signalData.filter(b=>b[sig]===false);
      const trueRate  = trueB.length  > 0 ? trueB.filter(b=>b.outcome_passed_chamber).length/trueB.length   : 0;
      const falseRate = falseB.length > 0 ? falseB.filter(b=>b.outcome_passed_chamber).length/falseB.length : 0;
      results.signal_lifts[sig] = {
        true_n:    trueB.length,
        true_rate: Math.round(trueRate*1000)/1000,
        false_rate:Math.round(falseRate*1000)/1000,
        lift:      falseRate > 0 ? Math.round((trueRate/falseRate)*100)/100 : 0,
        baseline:  Math.round(baseRate*1000)/1000,
      };
    }
  }

  // ── Write results to analysis table ─────────────────────────────────────────
  await supabase.from('sync_log').insert({
    session:       COMPLETED_SESSION,
    bills_fetched: 0,
    bills_updated: 0,
    snapshots_written: 0,
    errors:        null,
    duration_ms:   0,
    notes:         `Weekly retrospective: ${JSON.stringify(results).slice(0,500)}`,
  });

  return res.json({ success:true, ...results });
};

function getSessionState() {
  const today = new Date();
  if (today < new Date('2026-12-01')) return 'interim';
  if (today < new Date('2027-01-13')) return 'pre_filing';
  if (today <= new Date('2028-03-14')) return 'active';
  return 'signing_window';
}
