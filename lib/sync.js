require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch   = require('node-fetch');
const xml2js  = require('xml2js');
const { snapshotWeight, momentumTrend } = require('./decay');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WA_BASE  = process.env.WA_API_BASE;
const BIENNIUM = process.env.CURRENT_BIENNIUM;
const YEAR     = process.env.CURRENT_YEAR;
const SESSION  = `${YEAR}-${parseInt(YEAR)+1}`;

const SESSION_CALENDAR = {
  committee_cutoff: process.env.COMMITTEE_CUTOFF || '2026-02-07',
  floor_cutoff:     process.env.FLOOR_CUTOFF     || '2026-02-21',
  opposite_cutoff:  process.env.OPPOSITE_CUTOFF  || '2026-03-05',
  sine_die:         process.env.SINE_DIE          || '2026-03-14',
  session_start:    process.env.SESSION_START     || '2025-01-13',
};

async function fetchXML(endpoint, params) {
  const url = new URL(`${WA_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'Accept': 'text/xml' } });
  if (!res.ok) throw new Error(`WA API ${endpoint} returned ${res.status}`);
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
  return parser.parseStringPromise(text);
}

async function getAllBills(chamber) {
  const data = await fetchXML('GetLegislationByYear', {
    year: YEAR, biennium: BIENNIUM, agency: chamber,
  });
  const legislation = data?.ArrayOfLegislationInfo?.LegislationInfo;
  if (!legislation) return [];
  return Array.isArray(legislation) ? legislation : [legislation];
}

async function getBillDetail(billNumber) {
  const data = await fetchXML('GetLegislation', {
    biennium: BIENNIUM, billNumber,
  });
  const leg = data?.ArrayOfLegislation?.Legislation;
  if (!leg) return null;
  return Array.isArray(leg) ? leg[0] : leg;
}

function getDaysToCutoff(stage) {
  const today = new Date();
  const cutoffs = {
    1: SESSION_CALENDAR.committee_cutoff,
    2: SESSION_CALENDAR.committee_cutoff,
    3: SESSION_CALENDAR.floor_cutoff,
    4: SESSION_CALENDAR.opposite_cutoff,
    5: SESSION_CALENDAR.sine_die,
  };
  const cutoff = cutoffs[stage] || cutoffs[1];
  if (!cutoff) return 99;
  const diff = Math.ceil((new Date(cutoff) - today) / (1000*60*60*24));
  return Math.max(0, Math.min(99, diff));
}

function extractFeatures(rawBill, history) {
  const actions = (history || []).map(h =>
    (h.Action || h.HistoryAction || '').toLowerCase()
  );
  const joined = actions.join(' ');

  const hasPublicHearing  = joined.includes('public hearing');
  const hasExecSession    = joined.includes('executive action') ||
    (joined.includes('executive session') && !joined.includes('no action'));
  const committeePassed   = actions.some(a =>
    a.includes('do pass') && !a.includes('minority')
  );
  const pulledFromRules   = joined.includes('rules committee relieved');
  const heldInRules       = joined.includes('rules') &&
    !pulledFromRules && !committeePassed;
  const substituteFiled   = joined.includes('substitute bill') ||
    joined.includes('1st substitute');

  const referralActions = actions.filter(a =>
    a.includes('referred to') && !a.includes('rules')
  );
  const FISCAL = ['ways & means','appropriations','finance','capital budget'];
  const fiscalReferral  = referralActions.some(a => FISCAL.some(f => a.includes(f)));
  const doubleReferral  = referralActions.length >= 2 ||
    (referralActions.length >= 1 && fiscalReferral);

  const dateEntries = (history || [])
    .filter(h => h.ActionDate || h.Date)
    .map(h => new Date(h.ActionDate || h.Date))
    .filter(d => !isNaN(d));
  const lastDate  = dateEntries.length
    ? new Date(Math.max(...dateEntries)) : new Date();
  const daysSince = Math.floor((new Date() - lastDate) / (1000*60*60*24));
  const stalled   = daysSince > 21 && !committeePassed;

  let stage = 1;
  if (joined.includes('signed by governor') ||
      joined.includes('effective date'))         stage = 6;
  else if (joined.includes('delivered to governor') ||
           joined.includes("governor's desk"))   stage = 5;
  else if (joined.includes('third reading, passed') ||
           joined.includes('senate concurred'))  stage = 4;
  else if (joined.includes('third reading') ||
           joined.includes('floor'))             stage = 3;
  else if (committeePassed)                      stage = 2;
  else if (hasPublicHearing)                     stage = 2;

  const sessionStart = new Date(SESSION_CALENDAR.session_start);
  const firstReading = (history || []).find(h =>
    (h.Action||h.HistoryAction||'').toLowerCase().includes('first reading')
  );
  const introDate    = firstReading
    ? new Date(firstReading.ActionDate || firstReading.Date) : new Date();
  const sessionWeek  = Math.min(8, Math.max(1,
    Math.ceil((introDate - sessionStart) / (1000*60*60*24*7))
  ));

  const lastAction = (history || []).slice(-1)[0];

  return {
    has_public_hearing:    hasPublicHearing,
    has_executive_session: hasExecSession,
    committee_passed:      committeePassed,
    pulled_from_rules:     pulledFromRules,
    held_in_rules:         heldInRules,
    stalled,
    substitute_filed:      substituteFiled,
    double_referral:       doubleReferral,
    fiscal_referral:       fiscalReferral,
    days_since_action:     daysSince,
    session_week:          sessionWeek,
    stage,
    days_to_cutoff:        getDaysToCutoff(stage),
    last_action:      lastAction?.Action || lastAction?.HistoryAction || '',
    last_action_date: lastAction?.ActionDate || lastAction?.Date || '',
  };
}

function extractSponsors(sponsors) {
  if (!sponsors) return {
    prime_sponsor:'Unknown', prime_party:'',
    majority_sponsor:false, bipartisan:false,
    cosponsor_count:0, sponsor_tier:4, is_committee_chair:false
  };
  const arr   = Array.isArray(sponsors) ? sponsors : [sponsors];
  const prime = arr.find(s => (s.Order||s.SponsorOrder) === '1') || arr[0] || {};
  const rest  = arr.filter(s => s !== prime);
  const party = prime.Acronym || prime.Party || '';
  const bipartisan = rest.some(s =>
    (s.Acronym||s.Party||'') !== party && (s.Acronym||s.Party||'') !== ''
  );
  return {
    prime_sponsor:     `${prime.FirstName||''} ${prime.LastName||''}`.trim() || 'Unknown',
    prime_party:       party,
    majority_sponsor:  party === 'D',
    bipartisan,
    cosponsor_count:   rest.length,
    sponsor_tier:      party === 'D' ? 3 : 4,
    is_committee_chair: false,
  };
}

function detectCategory(title = '') {
  const t = title.toLowerCase();
  const CATS = {
    'Health':                  ['health','medical','hospital','medicaid','disease'],
    'Education':               ['school','education','student','teacher','university'],
    'Housing':                 ['housing','tenant','landlord','rent','zoning','eviction'],
    'Environment':             ['environment','climate','carbon','salmon','emission'],
    'Technology':              ['technology','data','privacy','cybersecurity','artificial'],
    'Budget / Appropriations': ['appropriat','budget','fiscal','revenue'],
    'Employment / Labor':      ['employee','wage','labor','worker','employment'],
    'Criminal Justice':        ['criminal','police','felony','sentencing','prison'],
    'Transportation':          ['transport','highway','transit','vehicle','ferry'],
    'Agriculture':             ['agricultur','farm','crop','livestock'],
    'Business / Commerce':     ['business','commerce','corporation','license','insurance'],
  };
  for (const [cat, keywords] of Object.entries(CATS)) {
    if (keywords.some(kw => t.includes(kw))) return cat;
  }
  return 'Other';
}

const SW = {
  hearing_pts:11, exec_session_pts:6, committee_pass_pts:8,
  double_referral_mult:1.05, majority_bonus:4, bipartisan_bonus:4,
  cosponsor_5_bonus:2, cosponsor_10_bonus:3, chair_bonus:5,
  category_baseline:8, late_intro_penalty:4, stall_penalty:8,
  fiscal_large_pts:3, fiscal_small_pts:8, fiscal_none_pts:10, fiscal_unknown_pts:8,
  xf_pulled_rules:0.15, xf_held_rules:0.20, xf_stalled_hard:0.18,
  xf_strong_margin:0.08, xf_narrow_margin:0.06, xf_minority_only:0.10,
  xf_substitute:0.05, xf_second_chamber:0.12,
  xf_deadline_critical:0.18, xf_deadline_warning:0.08,
};
const TIER_MULT = {1:1.0, 2:0.85, 3:0.70, 4:0.55, 5:0.30};

function scoreBill(bill, categoryRates) {
  let committee = 3;
  if (bill.has_public_hearing)  committee += SW.hearing_pts;
  if (bill.committee_passed)    committee += SW.committee_pass_pts;
  if (bill.has_executive_session && bill.committee_passed)
    committee += SW.exec_session_pts;
  if (bill.double_referral)
    committee = Math.round(committee * SW.double_referral_mult);
  committee = Math.max(0, Math.min(committee, 25));

  const tier = bill.sponsor_tier || 3;
  let sb = 8;
  if (bill.majority_sponsor)  sb += SW.majority_bonus;
  if (bill.bipartisan)        sb += SW.bipartisan_bonus;
  if ((bill.cosponsor_count||0) >= 10) sb += SW.cosponsor_10_bonus;
  else if ((bill.cosponsor_count||0) >= 5) sb += SW.cosponsor_5_bonus;
  if (bill.is_committee_chair) sb += SW.chair_bonus;
  const sponsor = Math.min(Math.round(sb * (TIER_MULT[tier]||0.55)), 20);

  const days = bill.days_since_action || 0;
  let momentum = days<=3?10:days<=7?7:days<=14?4:days<=21?2:0;
  if (bill.substitute_filed) momentum += 2;
  if (Math.min(bill.session_week||1, 8) >= 5) momentum -= SW.late_intro_penalty;
  if (bill.stalled) momentum -= SW.stall_penalty;
  momentum = Math.max(0, Math.min(momentum, 20));

  const catRate  = categoryRates[bill.category] ?? 0.427;
  const baseline = categoryRates['Other'] ?? 0.427;
  let historical = Math.round(
    SW.category_baseline + ((catRate - baseline) / baseline) * 10
  );
  const bn = parseInt((bill.bill_number||'').replace(/\D/g,'')) || 9999;
  const seq = (bill.bill_number||'').startsWith('H') ? bn-1000 : bn-5000;
  if (seq <= 200) historical += 2;
  else if (seq > 600) historical -= 1;
  historical = Math.max(0, Math.min(historical, 20));

  const fn = bill.fiscal_note_size || 'unknown';
  const fiscal = fn==='large'?SW.fiscal_large_pts
    :fn==='small'?SW.fiscal_small_pts
    :fn==='none'?SW.fiscal_none_pts
    :SW.fiscal_unknown_pts;

  const base_total = committee+sponsor+momentum+historical+fiscal;

  let xf = 1.0;
  const xf_factors = [];
  if (bill.pulled_from_rules) {
    xf += SW.xf_pulled_rules;
    xf_factors.push({l:'Pulled from Rules',d:+SW.xf_pulled_rules,pos:true});
  } else if (bill.held_in_rules) {
    xf -= SW.xf_held_rules;
    xf_factors.push({l:'Held in Rules',d:-SW.xf_held_rules,pos:false});
  }
  if (bill.stalled && !bill.held_in_rules) {
    xf -= SW.xf_stalled_hard;
    xf_factors.push({l:'Stalled >21d',d:-SW.xf_stalled_hard,pos:false});
  }
  if ((bill.stage||1) >= 4) {
    xf -= SW.xf_second_chamber;
    xf_factors.push({l:'2nd chamber',d:-SW.xf_second_chamber,pos:false});
  }
  if (!bill.majority_sponsor && !bill.bipartisan) {
    xf -= SW.xf_minority_only;
    xf_factors.push({l:'Minority only',d:-SW.xf_minority_only,pos:false});
  }
  if (bill.substitute_filed) {
    xf += SW.xf_substitute;
    xf_factors.push({l:'Substitute filed',d:+SW.xf_substitute,pos:true});
  }
  const dtc = bill.days_to_cutoff ?? 99;
  if (dtc<=5 && !bill.has_public_hearing && (bill.stage||1)<=2) {
    xf -= SW.xf_deadline_critical;
    xf_factors.push({l:`Cutoff: ${dtc}d`,d:-SW.xf_deadline_critical,pos:false});
  } else if (dtc<=12 && !bill.committee_passed && (bill.stage||1)<=2) {
    xf -= SW.xf_deadline_warning;
    xf_factors.push({l:`Cutoff warn`,d:-SW.xf_deadline_warning,pos:false});
  }
  xf = Math.round(Math.max(0.50, Math.min(1.50, xf)) * 1000) / 1000;

  const final_score = Math.min(100, Math.round(base_total * xf));

  let pass_prob=0.099, conf_label='MODERATE',
      conf_low=0.085, conf_high=0.116;
  if (bill.stalled || bill.held_in_rules)
    { pass_prob=0.000; conf_label='HIGH'; conf_low=0.000; conf_high=0.001; }
  else if (bill.committee_passed && bill.pulled_from_rules)
    { pass_prob=0.903; conf_label='HIGH'; conf_low=0.890; conf_high=0.914; }
  else if (!bill.has_public_hearing)
    { pass_prob=0.203; conf_label='HIGH'; conf_low=0.188; conf_high=0.219; }
  else if (final_score>=75)
    { pass_prob=1.000; conf_label='HIGH'; conf_low=0.787; conf_high=1.000; }
  else if (final_score>=60)
    { pass_prob=0.916; conf_label='HIGH'; conf_low=0.895; conf_high=0.933; }
  else if (final_score>=45)
    { pass_prob=0.732; conf_label='MODERATE'; conf_low=0.713; conf_high=0.749; }
  else if (final_score>=30)
    { pass_prob=0.212; conf_label='HIGH'; conf_low=0.197; conf_high=0.227; }

  return {
    committee, sponsor, momentum, historical, fiscal,
    base_total, xf_multiplier:xf, final_score, xf_factors,
    pass_prob, conf_label, conf_low, conf_high,
  };
}

async function runSync() {
  const startTime = Date.now();
  let billsFetched=0, billsUpdated=0, snapshotsWritten=0;
  const errors = [];

  console.log(`[${new Date().toISOString()}] Starting sync — ${SESSION}`);

  // Load calibration weights
  const { data: calData } = await supabase
    .from('calibration_weights')
    .select('category_rates')
    .eq('is_current', true)
    .single();

  const categoryRates = calData?.category_rates || {
    "Health":0.467,"Employment / Labor":0.455,"Education":0.449,
    "Budget / Appropriations":0.330,"Technology":0.325,
    "Housing":0.290,"Environment":0.275,"Other":0.427,
  };
  console.log('  Calibration weights loaded');

  try {
    const [houseBills, senateBills] = await Promise.all([
      getAllBills('House'),
      getAllBills('Senate'),
    ]);
    const allBills = [...houseBills, ...senateBills];
    billsFetched = allBills.length;
    console.log(`  Fetched ${billsFetched} bills from WA API`);

    const BATCH = 10;
    for (let i = 0; i < allBills.length; i += BATCH) {
      const batch = allBills.slice(i, i + BATCH);
      process.stdout.write(
        `  Scoring ${i}–${Math.min(i+BATCH, allBills.length)} of ${allBills.length}...\r`
      );

      await Promise.all(batch.map(async (rawBill) => {
        try {
          const billNum = rawBill.BillNumber || rawBill.BillId;
          if (!billNum) return;

          const detail  = await getBillDetail(billNum);
          const history = detail?.History?.LegislativeAction
            ? Array.isArray(detail.History.LegislativeAction)
              ? detail.History.LegislativeAction
              : [detail.History.LegislativeAction]
            : [];

          const sponsors  = extractSponsors(detail?.Sponsors?.Sponsor);
          const features  = extractFeatures(rawBill, history);
          const title     = rawBill.LongDescription || rawBill.ShortDescription || '';
          const category  = detectCategory(title);
          const billId    = `${SESSION}-${billNum}`;

          const billRecord = {
            bill_id:         billId,
            bill_number:     billNum,
            session:         SESSION,
            chamber:         rawBill.Agency,
            title:           title.slice(0, 200),
            category,
            status:          rawBill.CurrentStatus?.Status || 'Introduced',
            committee_name:  rawBill.CurrentStatus?.CommitteeName || '',
            bill_number_seq: parseInt(billNum.replace(/\D/g,'')) || 9999,
            fiscal_note_size: 'unknown',
            ...sponsors,
            ...features,
            raw_data:        rawBill,
            updated_at:      new Date().toISOString(),
          };

          const scores = scoreBill(billRecord, categoryRates);
          billRecord.final_score      = scores.final_score;
          billRecord.xf_multiplier    = scores.xf_multiplier;
          billRecord.pass_probability = scores.pass_prob;
          billRecord.confidence_label = scores.conf_label;
          billRecord.confidence_low   = scores.conf_low;
          billRecord.confidence_high  = scores.conf_high;

          const { error: uErr } = await supabase
            .from('bills')
            .upsert(billRecord, { onConflict: 'bill_id' });
          if (uErr) { errors.push({ bill: billNum, err: uErr.message }); return; }

          const today = new Date().toISOString().split('T')[0];
          const { error: sErr } = await supabase
            .from('trajectory_snapshots')
            .upsert({
              bill_id:          billId,
              session:          SESSION,
              score:            scores.final_score,
              base_total:       scores.base_total,
              xf_multiplier:    scores.xf_multiplier,
              stage:            features.stage,
              committee_score:  scores.committee,
              sponsor_score:    scores.sponsor,
              momentum_score:   scores.momentum,
              historical_score: scores.historical,
              fiscal_score:     scores.fiscal,
              pass_probability: scores.pass_prob,
              confidence_label: scores.conf_label,
              xf_factors:       scores.xf_factors,
              snapshot_date:    today,
            }, { onConflict: 'bill_id,snapshot_date' });

          if (!sErr) snapshotsWritten++;
          else errors.push({ bill: billNum, err: `snap: ${sErr.message}` });

          billsUpdated++;
        } catch(e) {
          errors.push({ bill: rawBill.BillNumber, err: e.message });
        }
      }));

      if (i + BATCH < allBills.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch(e) {
    errors.push({ err: e.message });
    console.error('\n  Error:', e.message);
  }

  const duration = Date.now() - startTime;
  console.log(`\n  Done: ${billsFetched} fetched, ${billsUpdated} updated, ${snapshotsWritten} snapshots, ${errors.length} errors (${duration}ms)`);

  await supabase.from('sync_log').insert({
    session:           SESSION,
    bills_fetched:     billsFetched,
    bills_updated:     billsUpdated,
    snapshots_written: snapshotsWritten,
    errors:            errors.length ? errors.slice(0,50) : null,
    duration_ms:       duration,
  });

  return { billsFetched, billsUpdated, snapshotsWritten, errors };
}

module.exports = { runSync };

if (require.main === module) {
  runSync().catch(console.error);
}