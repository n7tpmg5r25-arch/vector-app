require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch   = require('node-fetch');
const xml2js  = require('xml2js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WA_BASE  = process.env.WA_API_BASE;
const BIENNIUM = process.env.CURRENT_BIENNIUM;
const YEAR     = process.env.CURRENT_YEAR;
const SESSION  = `${YEAR}-${parseInt(YEAR)+1}`;

// ── SESSION STATE ─────────────────────────────────────────────────────────────
function getSessionState() {
  const today = new Date();
  const PRE_FILE = new Date('2026-12-01');
  const SES_START = new Date('2027-01-13');
  const SINE_DIE  = new Date('2028-03-14');
  if (today < PRE_FILE)   return 'interim';
  if (today < SES_START)  return 'pre_filing';
  if (today <= SINE_DIE)  return 'active';
  return 'signing_window';
}

// ── DEAD STATUSES ─────────────────────────────────────────────────────────────
const DEAD_STATUSES = [
  'died in committee','died in rules','failed','vetoed',
  'chaptered','filed with secretary of state',
];

function isDead(status = '') {
  return DEAD_STATUSES.some(d => status.toLowerCase().includes(d));
}

// ── WA API HELPERS ────────────────────────────────────────────────────────────
async function fetchXML(endpoint, params) {
  const url = new URL(`${WA_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'text/xml' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`WA API ${endpoint} → ${res.status}`);
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray:false, ignoreAttrs:true });
  return parser.parseStringPromise(text);
}

async function getAllBillsSummary() {
  const [houseData, senateData] = await Promise.all([
    fetchXML('GetLegislationByYear', { year:YEAR, biennium:BIENNIUM, agency:'House' }),
    fetchXML('GetLegislationByYear', { year:YEAR, biennium:BIENNIUM, agency:'Senate' }),
  ]);
  const house  = houseData?.ArrayOfLegislationInfo?.LegislationInfo  || [];
  const senate = senateData?.ArrayOfLegislationInfo?.LegislationInfo || [];
  const toArr  = x => Array.isArray(x) ? x : (x ? [x] : []);
  return [...toArr(house), ...toArr(senate)];
}

async function getBillDetail(billNumber) {
  const data = await fetchXML('GetLegislation', {
    biennium:BIENNIUM, billNumber,
  });
  const leg = data?.ArrayOfLegislation?.Legislation;
  if (!leg) return null;
  return Array.isArray(leg) ? leg[0] : leg;
}

// ── FEATURE EXTRACTION ────────────────────────────────────────────────────────
const SESSION_CAL = {
  start:    process.env.SESSION_START    || '2027-01-13',
  comm:     process.env.COMMITTEE_CUTOFF || '2028-02-07',
  floor:    process.env.FLOOR_CUTOFF     || '2028-02-21',
  opposite: process.env.OPPOSITE_CUTOFF  || '2028-03-05',
  sine_die: process.env.SINE_DIE         || '2028-03-14',
};

function getDaysToCutoff(stage) {
  const today = new Date();
  const map = { 1:SESSION_CAL.comm, 2:SESSION_CAL.comm,
                3:SESSION_CAL.floor, 4:SESSION_CAL.opposite,
                5:SESSION_CAL.sine_die };
  const cutoff = map[stage] || map[1];
  const diff = Math.ceil((new Date(cutoff) - today) / 86400000);
  return Math.max(0, Math.min(99, diff));
}

function extractFeatures(history = []) {
  const actions = history.map(h =>
    (h.Action || h.HistoryAction || '').toLowerCase()
  );
  const joined = actions.join(' ');

  const hasPublicHearing  = joined.includes('public hearing');
  const hasExecSession    = joined.includes('executive action') ||
    (joined.includes('executive session') && !joined.includes('no action'));
  const committeePassed   = actions.some(a =>
    a.includes('do pass') && !a.includes('minority'));
  const pulledFromRules   = joined.includes('rules committee relieved');
  const heldInRules       = joined.includes('rules') &&
    !pulledFromRules && !committeePassed;
  const substituteFiled   = joined.includes('substitute');
  const refs = actions.filter(a =>
    a.includes('referred to') && !a.includes('rules'));
  const FISCAL = ['ways & means','appropriations','finance','capital budget'];
  const fiscalReferral  = refs.some(a => FISCAL.some(f => a.includes(f)));
  const doubleReferral  = refs.length >= 2 ||
    (refs.length >= 1 && fiscalReferral);

  const dates = history
    .map(h => new Date(h.ActionDate || h.Date || ''))
    .filter(d => !isNaN(d));
  const lastDate  = dates.length ? new Date(Math.max(...dates)) : new Date();
  const daysSince = Math.floor((new Date() - lastDate) / 86400000);

  const state = getSessionState();
  const stalled = state === 'active' && daysSince > 21 && !committeePassed;

  let stage = 1;
  if (joined.includes('signed by governor') ||
      joined.includes('effective date'))         stage = 6;
  else if (joined.includes('delivered to governor')) stage = 5;
  else if (joined.includes('third reading, passed')) stage = 4;
  else if (joined.includes('third reading'))     stage = 3;
  else if (committeePassed)                      stage = 2;
  else if (hasPublicHearing)                     stage = 2;

  const sessionStart = new Date(SESSION_CAL.start);
  const firstRead = history.find(h =>
    (h.Action||h.HistoryAction||'').toLowerCase().includes('first reading'));
  const introDate = firstRead
    ? new Date(firstRead.ActionDate || firstRead.Date) : new Date();
  const sessionWeek = Math.min(8, Math.max(1,
    Math.ceil((introDate - sessionStart) / (86400000 * 7))));

  const lastAction = history.slice(-1)[0];

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
    cosponsor_count:0, sponsor_tier:4, is_committee_chair:false,
  };
  const arr   = Array.isArray(sponsors) ? sponsors : [sponsors];
  const prime = arr.find(s=>(s.Order||s.SponsorOrder)==='1') || arr[0] || {};
  const rest  = arr.filter(s => s !== prime);
  const party = prime.Acronym || prime.Party || '';
  return {
    prime_sponsor:     `${prime.FirstName||''} ${prime.LastName||''}`.trim(),
    prime_party:       party,
    majority_sponsor:  party === 'D',
    bipartisan:        rest.some(s=>(s.Acronym||s.Party||'')!==party&&(s.Acronym||s.Party||'')!==''),
    cosponsor_count:   rest.length,
    sponsor_tier:      party === 'D' ? 3 : 4,
    is_committee_chair: false,
  };
}

function detectCategory(title='') {
  const t = title.toLowerCase();
  const CATS = {
    'Health':['health','medical','hospital','medicaid','disease'],
    'Education':['school','education','student','teacher','university'],
    'Housing':['housing','tenant','landlord','rent','zoning','eviction'],
    'Environment':['environment','climate','carbon','salmon','emission'],
    'Technology':['technology','data','privacy','cybersecurity','artificial'],
    'Budget / Appropriations':['appropriat','budget','fiscal','revenue'],
    'Employment / Labor':['employee','wage','labor','worker'],
    'Criminal Justice':['criminal','police','felony','sentencing','prison'],
    'Transportation':['transport','highway','transit','vehicle','ferry'],
    'Agriculture':['agricultur','farm','crop','livestock'],
    'Business / Commerce':['business','commerce','corporation','license'],
  };
  for (const [cat,kws] of Object.entries(CATS))
    if (kws.some(kw=>t.includes(kw))) return cat;
  return 'Other';
}

// ── SCORING ENGINE ────────────────────────────────────────────────────────────
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
const TIER = {1:1.0,2:0.85,3:0.70,4:0.55,5:0.30};

function scoreBill(bill, categoryRates, state) {
  // Committee
  let committee = 3;
  if (bill.has_public_hearing)  committee += SW.hearing_pts;
  if (bill.committee_passed)    committee += SW.committee_pass_pts;
  if (bill.has_executive_session && bill.committee_passed)
    committee += SW.exec_session_pts;
  if (bill.double_referral)
    committee = Math.round(committee * SW.double_referral_mult);
  committee = Math.max(0, Math.min(committee, 25));

  // Sponsor
  const tier = bill.sponsor_tier || 3;
  let sb = 8;
  if (bill.majority_sponsor)   sb += SW.majority_bonus;
  if (bill.bipartisan)         sb += SW.bipartisan_bonus;
  if ((bill.cosponsor_count||0)>=10) sb += SW.cosponsor_10_bonus;
  else if ((bill.cosponsor_count||0)>=5) sb += SW.cosponsor_5_bonus;
  if (bill.is_committee_chair) sb += SW.chair_bonus;
  const sponsor = Math.min(Math.round(sb*(TIER[tier]||0.55)),20);

  // Momentum
  const days = bill.days_since_action || 0;
  let momentum = days<=3?10:days<=7?7:days<=14?4:days<=21?2:0;
  if (bill.substitute_filed) momentum += 2;
  if (Math.min(bill.session_week||1,8)>=5) momentum -= SW.late_intro_penalty;
  // Only apply stall penalty during active session
  if (bill.stalled && state==='active') momentum -= SW.stall_penalty;
  momentum = Math.max(0,Math.min(momentum,20));

  // Historical
  const catRate  = categoryRates[bill.category] ?? 0.427;
  const baseline = categoryRates['Other'] ?? 0.427;
  let historical = Math.round(
    SW.category_baseline + ((catRate-baseline)/baseline)*10);
  const bn  = parseInt((bill.bill_number||'').replace(/\D/g,''))||9999;
  const seq = (bill.bill_number||'').startsWith('H') ? bn-1000 : bn-5000;
  if (seq<=200) historical+=2; else if (seq>600) historical-=1;
  historical = Math.max(0,Math.min(historical,20));

  // Fiscal
  const fn = bill.fiscal_note_size||'unknown';
  const fiscal = fn==='large'?SW.fiscal_large_pts
    :fn==='small'?SW.fiscal_small_pts
    :fn==='none'?SW.fiscal_none_pts:SW.fiscal_unknown_pts;

  const base_total = committee+sponsor+momentum+historical+fiscal;

  // X Factor — session-state aware
  let xf = 1.0;
  const xf_factors = [];

  if (bill.pulled_from_rules) {
    xf+=SW.xf_pulled_rules;
    xf_factors.push({l:'Pulled from Rules',d:+SW.xf_pulled_rules,pos:true});
  } else if (bill.held_in_rules) {
    xf-=SW.xf_held_rules;
    xf_factors.push({l:'Held in Rules',d:-SW.xf_held_rules,pos:false});
  }

  // Stall and deadline only fire during active session
  if (state==='active') {
    if (bill.stalled && !bill.held_in_rules) {
      xf-=SW.xf_stalled_hard;
      xf_factors.push({l:'Stalled',d:-SW.xf_stalled_hard,pos:false});
    }
    const dtc = bill.days_to_cutoff??99;
    if (dtc<=5 && !bill.has_public_hearing && (bill.stage||1)<=2) {
      xf-=SW.xf_deadline_critical;
      xf_factors.push({l:`Cutoff: ${dtc}d`,d:-SW.xf_deadline_critical,pos:false});
    } else if (dtc<=12 && !bill.committee_passed && (bill.stage||1)<=2) {
      xf-=SW.xf_deadline_warning;
      xf_factors.push({l:`Cutoff warn`,d:-SW.xf_deadline_warning,pos:false});
    }
  }

  if ((bill.stage||1)>=4) {
    xf-=SW.xf_second_chamber;
    xf_factors.push({l:'2nd chamber',d:-SW.xf_second_chamber,pos:false});
  }
  if (!bill.majority_sponsor&&!bill.bipartisan) {
    xf-=SW.xf_minority_only;
    xf_factors.push({l:'Minority only',d:-SW.xf_minority_only,pos:false});
  }
  if (bill.substitute_filed) {
    xf+=SW.xf_substitute;
    xf_factors.push({l:'Substitute',d:+SW.xf_substitute,pos:true});
  }

  xf = Math.round(Math.max(0.50,Math.min(1.50,xf))*1000)/1000;
  const final_score = Math.min(100,Math.round(base_total*xf));

  let pass_prob=0.099,conf_label='MODERATE',conf_low=0.085,conf_high=0.116;
  if (bill.stalled||bill.held_in_rules)
    {pass_prob=0;conf_label='HIGH';conf_low=0;conf_high=0.001;}
  else if (bill.committee_passed&&bill.pulled_from_rules)
    {pass_prob=0.903;conf_label='HIGH';conf_low=0.890;conf_high=0.914;}
  else if (!bill.has_public_hearing)
    {pass_prob=0.203;conf_label='HIGH';conf_low=0.188;conf_high=0.219;}
  else if (final_score>=75)
    {pass_prob=1.0;conf_label='HIGH';conf_low=0.787;conf_high=1.0;}
  else if (final_score>=60)
    {pass_prob=0.916;conf_label='HIGH';conf_low=0.895;conf_high=0.933;}
  else if (final_score>=45)
    {pass_prob=0.732;conf_label='MODERATE';conf_low=0.713;conf_high=0.749;}
  else if (final_score>=30)
    {pass_prob=0.212;conf_label='HIGH';conf_low=0.197;conf_high=0.227;}

  return {
    committee,sponsor,momentum,historical,fiscal,
    base_total,xf_multiplier:xf,final_score,xf_factors,
    pass_prob,conf_label,conf_low,conf_high,
  };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Security check
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error:'Unauthorized' });
  }

  const startTime = Date.now();
  const state = getSessionState();
  const today = new Date().toISOString().split('T')[0];
  let billsFetched=0, changed=0, snapshotsWritten=0, errors=[];

  console.log(`[${new Date().toISOString()}] Sync start — ${SESSION} — state: ${state}`);

  // ── INTERIM: skip API calls, just log ───────────────────────────────────────
  if (state === 'interim') {
    await supabase.from('sync_log').insert({
      session:SESSION, bills_fetched:0, bills_updated:0,
      snapshots_written:0, errors:null,
      duration_ms: Date.now()-startTime,
      notes:'Skipped — interim period, no active session',
    });
    return res.json({ skipped:true, reason:'interim' });
  }

  // ── STEP 1: Load calibration weights ────────────────────────────────────────
  const { data:calData } = await supabase
    .from('calibration_weights')
    .select('category_rates')
    .eq('is_current',true)
    .single();
  const categoryRates = calData?.category_rates || {
    "Health":0.467,"Education":0.449,"Housing":0.290,
    "Environment":0.275,"Technology":0.325,
    "Budget / Appropriations":0.330,"Other":0.427,
  };

  // ── STEP 2: Fetch bill summary from WA API ──────────────────────────────────
  let allBills;
  try {
    allBills = await getAllBillsSummary();
    billsFetched = allBills.length;
    console.log(`  Fetched ${billsFetched} bill summaries`);
  } catch (e) {
    // API down — exit cleanly, don't touch snapshots or flags
    await supabase.from('sync_log').insert({
      session:SESSION, bills_fetched:0, bills_updated:0,
      snapshots_written:0,
      errors:[{err:`WA API unavailable: ${e.message}`}],
      duration_ms:Date.now()-startTime,
      notes:'Aborted — WA API error',
    });
    return res.json({ skipped:true, reason:'WA API error', error:e.message });
  }

  // ── STEP 3: Compare against DB, flag changed bills ──────────────────────────
  const { data:dbBills } = await supabase
    .from('bills')
    .select('bill_id,bill_number,status,last_action_date,stage,days_since_action')
    .eq('session', SESSION)
    .not('status', 'in', `(${DEAD_STATUSES.map(s=>`"${s}"`).join(',')})`);

  const dbMap = new Map((dbBills||[]).map(b=>[b.bill_number, b]));
  const flagged = [];
  const unchanged = [];

  for (const raw of allBills) {
    const billNum  = raw.BillNumber || raw.BillId;
    if (!billNum) continue;
    const existing = dbMap.get(billNum);
    const rawStatus  = raw.CurrentStatus?.Status || '';
    const rawDate    = raw.CurrentStatus?.ActionDate || '';

    if (!existing) {
      // New bill — flag for detail fetch
      flagged.push({ billNum, raw, isNew:true });
    } else {
      const statusChanged = existing.status !== rawStatus;
      const dateChanged   = existing.last_action_date !== rawDate;
      if (statusChanged || dateChanged) {
        flagged.push({ billNum, raw, isNew:false });
      } else {
        unchanged.push(existing);
      }
    }
  }

  console.log(`  ${flagged.length} changed, ${unchanged.length} unchanged`);
  changed = flagged.length;

  // ── STEP 4: Recalculate time-based signals + write snapshots for UNCHANGED ──
  // No API calls — uses existing DB data
  // Only update days_since_action, stall, days_to_cutoff
  if (unchanged.length > 0) {
    const today_date = new Date();
    const updates = unchanged.map(b => {
      const lastDate  = b.last_action_date ? new Date(b.last_action_date) : today_date;
      const daysSince = Math.floor((today_date - lastDate) / 86400000);
      const stalled   = state==='active' && daysSince>21 &&
                        !['committee_passed'].includes(b.status);
      return {
        bill_id:          b.bill_id,
        days_since_action: daysSince,
        stalled,
        days_to_cutoff:   getDaysToCutoff(b.stage||1),
        updated_at:       new Date().toISOString(),
      };
    });

    // Bulk update time-based signals
    for (let i=0; i<updates.length; i+=100) {
      await supabase.from('bills')
        .upsert(updates.slice(i,i+100), {onConflict:'bill_id'});
    }

    // Write today's snapshot for unchanged bills
    const snapshots = unchanged.map(b => ({
      bill_id:       b.bill_id,
      session:       SESSION,
      score:         b.final_score || 0,
      stage:         b.stage || 1,
      snapshot_date: today,
    }));

    for (let i=0; i<snapshots.length; i+=100) {
      await supabase.from('trajectory_snapshots')
        .upsert(snapshots.slice(i,i+100), {onConflict:'bill_id,snapshot_date'});
    }
    snapshotsWritten += unchanged.length;
  }

  // ── STEP 5: Fetch detail + score changed bills (LIMIT 100) ──────────────────
  const BATCH_LIMIT = 100;
  const toProcess = flagged.slice(0, BATCH_LIMIT);

  for (const { billNum, raw, isNew } of toProcess) {
    try {
      const detail  = await getBillDetail(billNum);
      const history = detail?.History?.LegislativeAction
        ? (Array.isArray(detail.History.LegislativeAction)
           ? detail.History.LegislativeAction
           : [detail.History.LegislativeAction])
        : [];

      const sponsors = extractSponsors(detail?.Sponsors?.Sponsor);
      const features = extractFeatures(history);
      const title    = raw.LongDescription || raw.ShortDescription || '';
      const category = detectCategory(title);
      const billId   = `${SESSION}-${billNum}`;

      const billRecord = {
        bill_id:         billId,
        bill_number:     billNum,
        session:         SESSION,
        chamber:         raw.Agency,
        title:           title.slice(0,200),
        category,
        status:          raw.CurrentStatus?.Status || 'Introduced',
        committee_name:  raw.CurrentStatus?.CommitteeName || '',
        bill_number_seq: parseInt(billNum.replace(/\D/g,''))||9999,
        fiscal_note_size:'unknown',
        ...sponsors,
        ...features,
        raw_data:        raw,
        updated_at:      new Date().toISOString(),
      };

      const scores = scoreBill(billRecord, categoryRates, state);
      billRecord.final_score      = scores.final_score;
      billRecord.xf_multiplier    = scores.xf_multiplier;
      billRecord.pass_probability = scores.pass_prob;
      billRecord.confidence_label = scores.conf_label;
      billRecord.confidence_low   = scores.conf_low;
      billRecord.confidence_high  = scores.conf_high;

      await supabase.from('bills')
        .upsert(billRecord, {onConflict:'bill_id'});

      // Write snapshot AFTER scoring — correct data, no lag
      await supabase.from('trajectory_snapshots')
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
        }, {onConflict:'bill_id,snapshot_date'});

      snapshotsWritten++;

    } catch(e) {
      errors.push({ bill:billNum, err:e.message });
    }
  }

  // If more than BATCH_LIMIT changed, remainder will be caught tomorrow
  if (flagged.length > BATCH_LIMIT) {
    console.log(`  ${flagged.length-BATCH_LIMIT} bills deferred to next run`);
  }

  const duration = Date.now()-startTime;
  console.log(`  Done: ${billsFetched} fetched, ${changed} changed, ${snapshotsWritten} snapshots, ${errors.length} errors (${duration}ms)`);

  await supabase.from('sync_log').insert({
    session:          SESSION,
    bills_fetched:    billsFetched,
    bills_updated:    changed,
    snapshots_written:snapshotsWritten,
    errors:           errors.length ? errors.slice(0,50) : null,
    duration_ms:      duration,
  });

  return res.json({
    success:true, state, billsFetched,
    changed, snapshotsWritten, errors:errors.length,
  });
};
