require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch  = require('node-fetch');
const xml2js = require('xml2js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WA_BASE  = process.env.WA_API_BASE;
const BIENNIUM = process.env.CURRENT_BIENNIUM;
const YEAR     = process.env.CURRENT_YEAR;
const SESSION  = `${parseInt(YEAR)-1}-${YEAR}`;

function getSessionState() {
  const today = new Date();
  if (today < new Date('2026-12-01')) return 'interim';
  if (today < new Date('2027-01-13')) return 'pre_filing';
  if (today <= new Date('2028-03-14')) return 'active';
  return 'signing_window';
}

async function fetchXML(endpoint, params) {
  const url = new URL(`${WA_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'text/xml' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray:false, ignoreAttrs:true });
  return parser.parseStringPromise(text);
}

async function getAllBillsSummary() {
  const [h, s] = await Promise.all([
    fetchXML('GetLegislationByYear', { year:YEAR, biennium:BIENNIUM, agency:'House' }),
    fetchXML('GetLegislationByYear', { year:YEAR, biennium:BIENNIUM, agency:'Senate' }),
  ]);
  const toArr = x => {
    const v = x?.ArrayOfLegislationInfo?.LegislationInfo;
    return Array.isArray(v) ? v : (v ? [v] : []);
  };
  return [...toArr(h), ...toArr(s)];
}

async function getHearings(billNumber) {
  try {
    const data = await fetchXML('GetHearings', {
      biennium:   BIENNIUM,
      billNumber: parseInt(billNumber),
    });
    const items = data?.ArrayOfHearing?.Hearing;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch(e) { return []; }
}

async function getStatusChanges(billId) {
  try {
    const startYear = parseInt(YEAR) - 1;
    const data = await fetchXML('GetLegislativeStatusChanges', {
      biennium:  BIENNIUM,
      billId:    billId,
      beginDate: `${startYear}-01-01`,
      endDate:   new Date().toISOString().split('T')[0],
    });
    const items = data?.ArrayOfLegislativeStatus?.LegislativeStatus;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch(e) { return []; }
}

async function getSponsors(billId) {
  try {
    const data = await fetchXML('GetSponsors', {
      biennium: BIENNIUM,
      billId:   billId,
    });
    const items = data?.ArrayOfSponsor?.Sponsor;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch(e) { return []; }
}

async function getAmendments(billNumber) {
  try {
    const data = await fetchXML('GetAmendmentsForBiennium', {
      biennium:   BIENNIUM,
      billNumber: parseInt(billNumber),
    });
    const items = data?.ArrayOfAmendment?.Amendment;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch(e) { return []; }
}

async function getRollCalls(billId) {
  try {
    const data = await fetchXML('GetRollCalls', {
      biennium: BIENNIUM,
      billId:   billId,
    });
    const items = data?.ArrayOfFloorAction?.FloorAction;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch(e) { return []; }
}

function makeBillId(raw) {
  const agency = raw.OriginalAgency || raw.Agency || 'House';
  const num    = raw.BillNumber || '';
  const prefix = agency === 'Senate' ? 'SB' : 'HB';
  return `${prefix} ${num}`;
}

function getDaysToCutoff(stage) {
  const today = new Date();
  const map = {
    1: process.env.COMMITTEE_CUTOFF || '2026-02-07',
    2: process.env.COMMITTEE_CUTOFF || '2026-02-07',
    3: process.env.FLOOR_CUTOFF     || '2026-02-21',
    4: process.env.OPPOSITE_CUTOFF  || '2026-03-05',
    5: process.env.SINE_DIE         || '2026-03-14',
  };
  const cutoff = map[stage] || map[1];
  const diff = Math.ceil((new Date(cutoff) - today) / 86400000);
  return Math.max(0, Math.min(99, diff));
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  const CATS = {
    'Health':                  ['health','medical','hospital','medicaid','disease'],
    'Education':               ['school','education','student','teacher','university'],
    'Housing':                 ['housing','tenant','landlord','rent','zoning','eviction'],
    'Environment':             ['environment','climate','carbon','salmon','emission'],
    'Technology':              ['technology','data','privacy','cybersecurity','artificial'],
    'Budget / Appropriations': ['appropriat','budget','fiscal','revenue'],
    'Employment / Labor':      ['employee','wage','labor','worker'],
    'Criminal Justice':        ['criminal','police','felony','sentencing','prison'],
    'Transportation':          ['transport','highway','transit','vehicle','ferry'],
    'Agriculture':             ['agricultur','farm','crop','livestock'],
    'Business / Commerce':     ['business','commerce','corporation','license'],
  };
  for (const [cat, kws] of Object.entries(CATS))
    if (kws.some(kw => t.includes(kw))) return cat;
  return 'Other';
}
function extractFeatures(hearings, statusChanges, amendments, rollCalls, state) {
  const hasPublicHearing = hearings.length > 0;

  const sortedHearings = hearings
    .filter(h => h.CommitteeMeeting?.Date)
    .sort((a,b) => new Date(a.CommitteeMeeting.Date) - new Date(b.CommitteeMeeting.Date));
  const hearingDate = sortedHearings.length > 0
    ? new Date(sortedHearings[0].CommitteeMeeting.Date).toISOString().split('T')[0]
    : null;

  const statusTexts = statusChanges.map(s =>
    (s.HistoryLine || s.Status || '').toLowerCase());
  const joined = statusTexts.join(' ');

  const hasExecSession  = joined.includes('executive action') ||
    (joined.includes('executive session') && !joined.includes('no action'));
  const committeePassed = statusTexts.some(s =>
    s.includes('do pass') && !s.includes('minority'));
  const pulledFromRules = joined.includes('rules committee relieved') ||
    joined.includes('removed from rules');
  const heldInRules     = joined.includes('held') && joined.includes('rules') &&
    !pulledFromRules;
  const passedFloor     = joined.includes('third reading, passed') ||
    joined.includes('passed third reading');
  const passedOpposite  = joined.includes('passed to senate') ||
    joined.includes('passed to house') ||
    joined.includes('delivered to governor');
  const signedByGov     = joined.includes('signed by governor') ||
    joined.includes('effective date') ||
    joined.includes('chaptered');

  let stage = 1;
  if (signedByGov)          stage = 6;
  else if (passedOpposite)  stage = 5;
  else if (passedFloor)     stage = 4;
  else if (committeePassed) stage = 3;
  else if (hasPublicHearing || hasExecSession) stage = 2;

  const referrals = statusChanges.filter(s =>
    (s.HistoryLine || '').toLowerCase().includes('referred to'));
  const FISCAL = ['ways & means','appropriations','finance','capital budget'];
  const fiscalReferral = referrals.some(s =>
    FISCAL.some(f => (s.HistoryLine||'').toLowerCase().includes(f)));
  const doubleReferral = referrals.length >= 2;

  const substituteFiled = amendments.some(a =>
    (a.AmendmentType || a.Description || '').toLowerCase().includes('substitute'));
  const amendmentCount = amendments.length;

  const allDates = statusChanges
    .map(s => new Date(s.ActionDate || s.StatusDate || ''))
    .filter(d => !isNaN(d));
  const lastDate  = allDates.length ? new Date(Math.max(...allDates)) : new Date();
  const daysSince = Math.floor((new Date() - lastDate) / 86400000);
  const stalled   = state === 'active' && daysSince > 21 && !committeePassed;

  let avgFloorMargin = null;
  if (rollCalls.length > 0) {
    const margins = rollCalls
      .map(r => {
        const yea = parseInt(r.YeaVotes) || 0;
        const nay = parseInt(r.NayVotes) || 0;
        return yea + nay > 0 ? yea / (yea + nay) : null;
      })
      .filter(m => m !== null);
    if (margins.length > 0)
      avgFloorMargin = margins.reduce((a,b) => a+b, 0) / margins.length;
  }

  const sessionStart = new Date(`${parseInt(YEAR)-1}-01-13`);
  const firstStatus  = statusChanges.find(s =>
    (s.HistoryLine || '').toLowerCase().includes('first reading'));
  const introDate   = firstStatus
    ? new Date(firstStatus.ActionDate || firstStatus.StatusDate)
    : new Date();
  const sessionWeek = Math.min(8, Math.max(1,
    Math.ceil((introDate - sessionStart) / (86400000 * 7))));

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
    amendment_count:       amendmentCount,
    session_week:          sessionWeek,
    days_since_action:     daysSince,
    stage,
    days_to_cutoff:        getDaysToCutoff(stage),
    avg_floor_margin:      avgFloorMargin,
    hearing_date:          hearingDate,
    last_action_date:      lastDate.toISOString(),
  };
}

function extractSponsors(sponsors) {
  if (!sponsors || sponsors.length === 0) return {
    prime_sponsor:'Unknown', prime_party:'',
    majority_sponsor:false, bipartisan:false,
    cosponsor_count:0, sponsor_tier:4, is_committee_chair:false,
  };
  const prime = sponsors.find(s => s.Order==='1' || s.Type==='Prime') || sponsors[0];
  const rest  = sponsors.filter(s => s !== prime);
  const party = prime.Acronym || prime.Party || '';
  return {
    prime_sponsor:      `${prime.FirstName||''} ${prime.LastName||''}`.trim() || 'Unknown',
    prime_party:        party,
    majority_sponsor:   party === 'D',
    bipartisan:         rest.some(s =>
      (s.Acronym||s.Party||'') !== party && (s.Acronym||s.Party||'') !== ''),
    cosponsor_count:    rest.length,
    sponsor_tier:       party === 'D' ? 3 : 4,
    is_committee_chair: false,
  };
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
const TIER = { 1:1.0, 2:0.85, 3:0.70, 4:0.55, 5:0.30 };

function scoreBill(bill, categoryRates, state) {
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
  const sponsor = Math.min(Math.round(sb * (TIER[tier]||0.55)), 20);

  const days = bill.days_since_action || 0;
  let momentum = days<=3?10:days<=7?7:days<=14?4:days<=21?2:0;
  if (bill.substitute_filed) momentum += 2;
  if (Math.min(bill.session_week||1, 8) >= 5) momentum -= SW.late_intro_penalty;
  if (bill.stalled && state === 'active') momentum -= SW.stall_penalty;
  momentum = Math.max(0, Math.min(momentum, 20));

  const catRate  = categoryRates[bill.category] ?? 0.427;
  const baseline = categoryRates['Other'] ?? 0.427;
  let historical = Math.round(
    SW.category_baseline + ((catRate - baseline) / baseline) * 10);
  const bn  = parseInt((bill.bill_number||'').replace(/\D/g,'')) || 9999;
  const seq = (bill.bill_number||'').startsWith('H') ? bn-1000 : bn-5000;
  if (seq <= 200) historical += 2;
  else if (seq > 600) historical -= 1;
  historical = Math.max(0, Math.min(historical, 20));

  const fn = bill.fiscal_note_size || 'unknown';
  const fiscal = fn==='large'  ? SW.fiscal_large_pts
    : fn==='small' ? SW.fiscal_small_pts
    : fn==='none'  ? SW.fiscal_none_pts
    : SW.fiscal_unknown_pts;

  const base_total = committee + sponsor + momentum + historical + fiscal;

  let xf = 1.0;
  const xf_factors = [];

  if (bill.pulled_from_rules) {
    xf += SW.xf_pulled_rules;
    xf_factors.push({l:'Pulled from Rules', d:+SW.xf_pulled_rules, pos:true});
  } else if (bill.held_in_rules) {
    xf -= SW.xf_held_rules;
    xf_factors.push({l:'Held in Rules', d:-SW.xf_held_rules, pos:false});
  }

  if (state === 'active') {
    if (bill.stalled && !bill.held_in_rules) {
      xf -= SW.xf_stalled_hard;
      xf_factors.push({l:'Stalled', d:-SW.xf_stalled_hard, pos:false});
    }
    const dtc = bill.days_to_cutoff ?? 99;
    if (dtc<=5 && !bill.has_public_hearing && (bill.stage||1)<=2) {
      xf -= SW.xf_deadline_critical;
      xf_factors.push({l:'Cutoff critical', d:-SW.xf_deadline_critical, pos:false});
    } else if (dtc<=12 && !bill.committee_passed && (bill.stage||1)<=2) {
      xf -= SW.xf_deadline_warning;
      xf_factors.push({l:'Cutoff warn', d:-SW.xf_deadline_warning, pos:false});
    }
  }

  if ((bill.stage||1) >= 4) {
    xf -= SW.xf_second_chamber;
    xf_factors.push({l:'2nd chamber', d:-SW.xf_second_chamber, pos:false});
  }
  if (!bill.majority_sponsor && !bill.bipartisan) {
    xf -= SW.xf_minority_only;
    xf_factors.push({l:'Minority only', d:-SW.xf_minority_only, pos:false});
  }
  if (bill.substitute_filed) {
    xf += SW.xf_substitute;
    xf_factors.push({l:'Substitute', d:+SW.xf_substitute, pos:true});
  }
  if (bill.avg_floor_margin != null) {
    if (bill.avg_floor_margin >= 0.75) {
      xf += SW.xf_strong_margin;
      xf_factors.push({l:'Strong margin', d:+SW.xf_strong_margin, pos:true});
    } else if (bill.avg_floor_margin < 0.60) {
      xf -= SW.xf_narrow_margin;
      xf_factors.push({l:'Narrow margin', d:-SW.xf_narrow_margin, pos:false});
    }
  }

  xf = Math.round(Math.max(0.50, Math.min(1.50, xf)) * 1000) / 1000;
  const final_score = Math.min(100, Math.round(base_total * xf));

  let pass_prob=0.099, conf_label='MODERATE', conf_low=0.085, conf_high=0.116;
  if (bill.stalled || bill.held_in_rules)
    { pass_prob=0; conf_label='HIGH'; conf_low=0; conf_high=0.001; }
  else if (bill.committee_passed && bill.pulled_from_rules)
    { pass_prob=0.903; conf_label='HIGH'; conf_low=0.890; conf_high=0.914; }
  else if (!bill.has_public_hearing)
    { pass_prob=0.203; conf_label='HIGH'; conf_low=0.188; conf_high=0.219; }
  else if (final_score >= 75)
    { pass_prob=1.0; conf_label='HIGH'; conf_low=0.787; conf_high=1.0; }
  else if (final_score >= 60)
    { pass_prob=0.916; conf_label='HIGH'; conf_low=0.895; conf_high=0.933; }
  else if (final_score >= 45)
    { pass_prob=0.732; conf_label='MODERATE'; conf_low=0.713; conf_high=0.749; }
  else if (final_score >= 30)
    { pass_prob=0.212; conf_label='HIGH'; conf_low=0.197; conf_high=0.227; }

  return {
    committee, sponsor, momentum, historical, fiscal,
    base_total, xf_multiplier:xf, final_score, xf_factors,
    pass_prob, conf_label, conf_low, conf_high,
  };
}
async function processBill(raw, categoryRates, state) {
  const billNum   = raw.BillNumber || raw.BillId?.replace(/\D/g,'');
  if (!billNum) return null;

  const billApiId = makeBillId(raw);
  const title     = raw.LongDescription || raw.ShortDescription || '';
  const category  = detectCategory(title);
  const billId    = `${SESSION}-${billNum}`;

  const [hearings, statusChanges, sponsors, amendments, rollCalls] =
    await Promise.all([
      getHearings(billNum),
      getStatusChanges(billApiId),
      getSponsors(billApiId),
      getAmendments(billNum),
      getRollCalls(billApiId),
    ]);

  const features    = extractFeatures(hearings, statusChanges, amendments, rollCalls, state);
  const sponsorData = extractSponsors(sponsors);
  const hasFiscal   = raw.LocalFiscalNote==='true' || raw.StateFiscalNote==='true';

  const billRecord = {
    bill_id:         billId,
    bill_number:     billNum,
    session:         SESSION,
    chamber:         raw.OriginalAgency || raw.Agency || 'House',
    title:           title.slice(0, 200),
    category,
    status:          raw.CurrentStatus?.Status || 'Introduced',
    committee_name:  raw.CurrentStatus?.CommitteeName || '',
    bill_number_seq: parseInt(billNum) || 9999,
    fiscal_note_size: hasFiscal ? 'small' : 'unknown',
    ...sponsorData,
    ...features,
    raw_data: {
      summary:          raw,
      hearings_count:   hearings.length,
      status_changes:   statusChanges.length,
      amendments_count: amendments.length,
      rollcalls_count:  rollCalls.length,
    },
    updated_at: new Date().toISOString(),
  };

  const scores = scoreBill(billRecord, categoryRates, state);
  billRecord.final_score      = scores.final_score;
  billRecord.xf_multiplier    = scores.xf_multiplier;
  billRecord.pass_probability = scores.pass_prob;
  billRecord.confidence_label = scores.conf_label;
  billRecord.confidence_low   = scores.conf_low;
  billRecord.confidence_high  = scores.conf_high;

  return { billRecord, scores };
}

async function runSync() {
  const startTime = Date.now();
  const state     = getSessionState();
  const today     = new Date().toISOString().split('T')[0];
  let billsFetched=0, billsUpdated=0, snapshotsWritten=0;
  const errors = [];

  console.log(`[${new Date().toISOString()}] Sync -- ${SESSION} -- state: ${state}`);

  const { data:cal } = await supabase
    .from('calibration_weights')
    .select('category_rates')
    .eq('is_current', true)
    .single();
  const categoryRates = cal?.category_rates || { 'Health':0.467, 'Other':0.427 };

  let allBills;
  try {
    allBills = await getAllBillsSummary();
    billsFetched = allBills.length;
    console.log(`  Fetched ${billsFetched} bills`);
  } catch(e) {
    console.error('  WA API unavailable:', e.message);
    await supabase.from('sync_log').insert({
      session:SESSION, bills_fetched:0, bills_updated:0,
      snapshots_written:0, errors:[{err:e.message}],
      duration_ms:Date.now()-startTime,
      notes:'Aborted -- WA API error',
    });
    return;
  }

  const BATCH = 5;
  for (let i=0; i<allBills.length; i+=BATCH) {
    const batch = allBills.slice(i, i+BATCH);
    process.stdout.write(
      `  Processing ${i}-${Math.min(i+BATCH, allBills.length)} of ${allBills.length}...\r`
    );

    await Promise.all(batch.map(async raw => {
      try {
        const result = await processBill(raw, categoryRates, state);
        if (!result) return;
        const { billRecord, scores } = result;

        const { error:uErr } = await supabase
          .from('bills')
          .upsert(billRecord, { onConflict:'bill_id' });
        if (uErr) {
          errors.push({ bill:billRecord.bill_number, err:uErr.message });
          return;
        }

        const { error:sErr } = await supabase
          .from('trajectory_snapshots')
          .upsert({
            bill_id:          billRecord.bill_id,
            session:          SESSION,
            score:            scores.final_score,
            base_total:       scores.base_total,
            xf_multiplier:    scores.xf_multiplier,
            stage:            billRecord.stage,
            committee_score:  scores.committee,
            sponsor_score:    scores.sponsor,
            momentum_score:   scores.momentum,
            historical_score: scores.historical,
            fiscal_score:     scores.fiscal,
            pass_probability: scores.pass_prob,
            confidence_label: scores.conf_label,
            xf_factors:       scores.xf_factors,
            snapshot_date:    today,
          }, { onConflict:'bill_id,snapshot_date' });

        if (!sErr) snapshotsWritten++;
        else errors.push({ bill:billRecord.bill_number, err:`snap: ${sErr.message}` });

        billsUpdated++;
      } catch(e) {
        errors.push({ bill:raw.BillNumber, err:e.message });
      }
    }));

    if (i + BATCH < allBills.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const duration = Date.now() - startTime;
  console.log(`  Done: ${billsFetched} fetched, ${billsUpdated} updated, ${snapshotsWritten} snapshots, ${errors.length} errors (${duration}ms)`);

  await supabase.from('sync_log').insert({
    session:           SESSION,
    bills_fetched:     billsFetched,
    bills_updated:     billsUpdated,
    snapshots_written: snapshotsWritten,
    errors:            errors.length ? errors.slice(0, 50) : null,
    duration_ms:       duration,
  });
}

module.exports = { runSync, processBill };

if (require.main === module) {
  runSync().catch(console.error);
}
