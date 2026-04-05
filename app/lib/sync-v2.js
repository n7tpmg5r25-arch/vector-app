/**
 * VECTOR | WA — Sync Script v2.2 (Phase 5A — Reliability + Data Gaps)
 * lib/sync-v2.js
 *
 * Fetches all WA Legislature bills, scores them with the calibrated
 * trajectory model, and writes results to Supabase.
 *
 * v2.2 CHANGES (Phase 5A):
 *  - Retry with exponential backoff on API failures (3 retries)
 *  - 10-second timeout per API call (was 30s — hangs caused 83+ min runs)
 *  - committee_name populated from GetLegislation CurrentStatus.Committee
 *  - last_action populated from most recent status change description
 *  - Batch size increased to 10 with staggered delays (faster throughput)
 *  - Better error isolation — one bill failing doesn't stall the batch
 *  - Progress logging every 50 bills instead of every batch
 *
 * Previous fixes (v2.0-v2.1):
 *  - fiscal_score, momentum_score, sponsor_score ranges fixed
 *  - Stage advancement bonus, X Factors, confidence labels calibrated
 *  - GetRollCalls param fix, companion_bill extraction
 *  - Calibration against actual 2025-26 outcomes
 *
 * Data flow:
 *   WA Legislature API (XML)
 *     → parseXML (xml2js)
 *     → extractFeatures (history analysis)
 *     → scoreEngine (calibrated weights + stage bonus + X Factor)
 *     → Supabase upsert (bills table)
 *     → trajectory_snapshots insert (one per bill per day)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch    = require('node-fetch');
const xml2js   = require('xml2js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WA_BASE  = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov';
const BIENNIUM = process.env.CURRENT_BIENNIUM;   // e.g. '2027-28'
const YEAR     = process.env.CURRENT_YEAR;        // e.g. '2027'
const SESSION  = `${parseInt(YEAR)-1}-${YEAR}`;   // e.g. '2026-2027'

// Session cutoff calendar — update each session
const SESSION_CALENDAR = {
  committee_cutoff: process.env.COMMITTEE_CUTOFF || '2028-02-07',
  floor_cutoff:     process.env.FLOOR_CUTOFF     || '2028-02-21',
  opposite_cutoff:  process.env.OPPOSITE_CUTOFF  || '2028-03-05',
  sine_die:         process.env.SINE_DIE         || '2028-03-14',
  session_start:    process.env.SESSION_START     || '2027-01-13',
};

// ── SESSION STATE ─────────────────────────────────────────────────────────────
function getSessionState() {
  const today = new Date();
  const sineDate = new Date(SESSION_CALENDAR.sine_die);
  const startDate = new Date(SESSION_CALENDAR.session_start);
  if (today < startDate) return 'pre_filing';
  if (today <= sineDate) return 'active';
  return 'interim';
}

// ── CALIBRATED WEIGHTS ────────────────────────────────────────────────────────
async function loadCalibratedWeights() {
  const { data, error } = await supabase
    .from('calibration_weights')
    .select('*')
    .eq('is_current', true)
    .single();

  if (error || !data) {
    console.warn('  Using fallback hardcoded weights');
    return getHardcodedWeights();
  }
  console.log(`  Loaded calibration from ${data.computed_at}`);
  return data;
}

function getHardcodedWeights() {
  // Calibrated against actual 2025-26 session outcomes (April 2, 2026)
  return {
    category_rates: {
      "Transportation": 0.090, "Technology": 0.068, "Agriculture": 0.063,
      "Health": 0.054, "Employment / Labor": 0.051, "Other": 0.045,
      "Housing": 0.042, "Environment": 0.041, "Business / Commerce": 0.034,
      "Criminal Justice": 0.026, "Education": 0.025, "Budget / Appropriations": 0.000,
    },
    bucket_pass_rates: {
      "0-30": 0.000, "30-45": 0.000, "45-60": 0.008,
      "60-75": 0.051, "75-100": 0.293,
    },
  };
}

// ── RETRY + TIMEOUT HELPERS (Phase 5A) ───────────────────────────────────────
const API_TIMEOUT_MS = 10000;  // 10 seconds per API call (was 30s)
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;    // 1s, 2s, 4s backoff

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── WA API HELPERS ────────────────────────────────────────────────────────────
async function fetchXML(service, endpoint, params) {
  const url = new URL(`${WA_BASE}/${service}/${endpoint}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetchWithRetry(url.toString(), {
    headers: { 'Accept': 'text/xml' },
  });
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
  return parser.parseStringPromise(text);
}

async function getAllBillsSummary() {
  const [h, s] = await Promise.all([
    fetchXML('LegislationService.asmx', 'GetLegislationByYear', { year: YEAR, biennium: BIENNIUM, agency: 'House' }),
    fetchXML('LegislationService.asmx', 'GetLegislationByYear', { year: YEAR, biennium: BIENNIUM, agency: 'Senate' }),
  ]);
  const toArr = x => { const v = x?.ArrayOfLegislationInfo?.LegislationInfo; return Array.isArray(v) ? v : (v ? [v] : []); };
  return [...toArr(h), ...toArr(s)];
}

async function getStatusChanges(billId) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetLegislativeStatusChangesByBillId', {
      biennium: BIENNIUM, billId,
      beginDate: `${parseInt(YEAR)-1}-01-01`,
      endDate: new Date().toISOString().split('T')[0],
    });
    const items = data?.ArrayOfLegislativeStatus?.LegislativeStatus;
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch(e) { return []; }
}

// Phase 5C.3 — REMOVED getSponsors(). Sponsors are now pulled from the
// full legislation object returned by GetLegislation (which includes Sponsors
// inline). This also eliminates ~3,111 redundant API calls per nightly sync.

async function getHearings(billNumber) {
  try {
    const data = await fetchXML('CommitteeMeetingService.asmx', 'GetHearings', {
      biennium: BIENNIUM, billNumber: parseInt(billNumber),
    });
    const items = data?.ArrayOfHearing?.Hearing;
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch(e) { return []; }
}

async function getAmendments(billNumber) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetAmendmentsForBiennium', {
      biennium: BIENNIUM, billNumber: parseInt(billNumber),
    });
    const items = data?.ArrayOfAmendment?.Amendment;
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch(e) { return []; }
}

// BUG FIX: GetRollCalls takes "billNumber" (e.g. "1001"), NOT "billId" (e.g. "HB 1001")
async function getRollCalls(billNumber) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetRollCalls', { biennium: BIENNIUM, billNumber });
    const items = data?.ArrayOfRollCall?.RollCall;
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch(e) { return []; }
}

// Get full legislation details (for companion bill + committee)
async function getLegislation(billNumber) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetLegislation', { biennium: BIENNIUM, billNumber });
    const items = data?.ArrayOfLegislation?.Legislation;
    const arr = Array.isArray(items) ? items : (items ? [items] : []);
    return arr[0] || null;
  } catch(e) { return null; }
}

function makeBillId(raw) {
  const agency = raw.OriginalAgency || raw.Agency || 'House';
  const num = raw.BillNumber || '';
  const prefix = agency === 'Senate' ? 'SB' : 'HB';
  return `${prefix} ${num}`;
}

// ── DAYS TO CUTOFF ────────────────────────────────────────────────────────────
function getDaysToCutoff(stage) {
  const today = new Date();
  const cutoffs = {
    1: SESSION_CALENDAR.committee_cutoff,
    2: SESSION_CALENDAR.committee_cutoff,
    3: SESSION_CALENDAR.floor_cutoff,
    4: SESSION_CALENDAR.opposite_cutoff,
    5: SESSION_CALENDAR.sine_die,
    6: null,
  };
  const cutoff = cutoffs[stage] || cutoffs[1];
  if (!cutoff) return 99;
  const diff = Math.ceil((new Date(cutoff) - today) / 86400000);
  return Math.max(0, Math.min(99, diff));
}

// ── CATEGORY DETECTION ────────────────────────────────────────────────────────
function detectCategory(title = '') {
  const t = title.toLowerCase();
  const CATS = {
    'Health': ['health','medical','hospital','medicaid','medicare','mental health','substance','disease','pharmacy'],
    'Education': ['school','education','student','teacher','university','college','curriculum'],
    'Housing': ['housing','tenant','landlord','rent','zoning','eviction','homeless'],
    'Environment': ['environment','climate','carbon','emission','pollution','water quality','salmon','forest'],
    'Technology': ['technology','data','privacy','cybersecurity','artificial intelligence','digital'],
    'Budget / Appropriations': ['appropriat','budget','fund','fiscal','revenue','tax credit'],
    'Employment / Labor': ['employee','employer','wage','labor','worker','employment','unemployment','workplace'],
    'Criminal Justice': ['criminal','police','law enforcement','felony','misdemeanor','sentencing','jail','prison','offense'],
    'Transportation': ['transport','highway','road','transit','vehicle','ferry','traffic'],
    'Agriculture': ['agricultur','farm','crop','livestock','irrigation','pesticide'],
    'Business / Commerce': ['business','commerce','corporation','license','contract','trade','insurance'],
  };
  for (const [cat, keywords] of Object.entries(CATS)) {
    if (keywords.some(kw => t.includes(kw))) return cat;
  }
  return 'Other';
}

// ── FEATURE EXTRACTION ────────────────────────────────────────────────────────
// Phase 5C.2: now also accepts `legislation` so fiscal-note fields can be read
// from the full Legislation object (raw = LegislationInfo lacks these fields).
function extractFeatures(hearings, statusChanges, amendments, rollCalls, raw, state, legislation) {
  const hasPublicHearing = hearings.length > 0;

  const sortedHearings = hearings
    .filter(h => h.CommitteeMeeting?.Date)
    .sort((a,b) => new Date(a.CommitteeMeeting.Date) - new Date(b.CommitteeMeeting.Date));
  const hearingDate = sortedHearings.length > 0
    ? new Date(sortedHearings[0].CommitteeMeeting.Date).toISOString().split('T')[0]
    : null;

  const statusTexts = statusChanges.map(s => (s.HistoryLine || s.Status || '').toLowerCase());
  const joined = statusTexts.join(' ');

  const hasExecSession = joined.includes('executive action') ||
    (joined.includes('executive session') && !joined.includes('no action'));
  const committeePassed = statusTexts.some(s => s.includes('do pass') && !s.includes('minority'));
  const pulledFromRules = joined.includes('rules committee relieved') || joined.includes('removed from rules');
  const heldInRules = joined.includes('held') && joined.includes('rules') && !pulledFromRules;
  const passedFloor = joined.includes('third reading, passed') || joined.includes('passed third reading');
  const passedOpposite = joined.includes('passed to senate') || joined.includes('passed to house') || joined.includes('delivered to governor');
  const signedByGov = joined.includes('signed by governor') || joined.includes('effective date') || joined.includes('chaptered');

  let stage = 1;
  if (signedByGov) stage = 6;
  else if (passedOpposite) stage = 5;
  else if (passedFloor) stage = 4;
  else if (committeePassed) stage = 3;
  else if (hasPublicHearing || hasExecSession) stage = 2;

  const referrals = statusChanges.filter(s => (s.HistoryLine || '').toLowerCase().includes('referred to'));
  const FISCAL = ['ways & means','appropriations','finance','capital budget'];
  const fiscalReferral = referrals.some(s => FISCAL.some(f => (s.HistoryLine||'').toLowerCase().includes(f)));
  const doubleReferral = referrals.length >= 2;

  // Substitute detection — from amendments AND raw API data
  const substituteFiled = amendments.some(a =>
    (a.AmendmentType || a.Description || '').toLowerCase().includes('substitute'))
    || parseInt(raw.SubstituteVersion || '0') > 0;
  const amendmentCount = amendments.length;

  const allDates = statusChanges
    .map(s => new Date(s.ActionDate || s.StatusDate || ''))
    .filter(d => !isNaN(d));
  const lastDate = allDates.length ? new Date(Math.max(...allDates)) : new Date();
  const daysSince = Math.floor((new Date() - lastDate) / 86400000);

  // Stalled: only during active session or if clearly dead in interim
  const stalled = daysSince > 21 && stage <= 3 && !committeePassed;

  // Fiscal note size — derive from API fields + referral patterns
  // Phase 5C.2: LocalFiscalNote / StateFiscalNote live on the full Legislation
  // object, NOT on the LegislationInfo summary (raw). Read from legislation
  // first, then fall back to raw for safety. Values may be booleans or strings.
  const leg = legislation || {};
  const localFn = leg.LocalFiscalNote ?? raw.LocalFiscalNote;
  const stateFn = leg.StateFiscalNote ?? raw.StateFiscalNote;
  const isTrue = v => v === true || v === 'true' || v === 'True';
  const hasFiscal = isTrue(localFn) || isTrue(stateFn);
  let fiscalNoteSize = 'none';
  if (hasFiscal && fiscalReferral && doubleReferral) fiscalNoteSize = 'large';
  else if (hasFiscal && fiscalReferral) fiscalNoteSize = 'medium';
  else if (hasFiscal) fiscalNoteSize = 'small';

  // Roll call vote margins
  let avgFloorMargin = null;
  if (rollCalls.length > 0) {
    const margins = rollCalls
      .map(r => { const y = parseInt(r.YeaVotes)||0; const n = parseInt(r.NayVotes)||0; return y+n > 0 ? y/(y+n) : null; })
      .filter(m => m !== null);
    if (margins.length > 0) avgFloorMargin = margins.reduce((a,b) => a+b, 0) / margins.length;
  }

  const sessionStart = new Date(SESSION_CALENDAR.session_start);
  const firstStatus = statusChanges.find(s => (s.HistoryLine || '').toLowerCase().includes('first reading'));
  const introDate = firstStatus ? new Date(firstStatus.ActionDate || firstStatus.StatusDate) : new Date();
  const sessionWeek = Math.min(8, Math.max(1, Math.ceil((introDate - sessionStart) / (86400000 * 7))));

  // NEW (Phase 5A): Extract last_action text from most recent status change
  let lastAction = '';
  if (statusChanges.length > 0) {
    const sorted = [...statusChanges].sort((a, b) => {
      const da = new Date(a.ActionDate || a.StatusDate || 0);
      const db = new Date(b.ActionDate || b.StatusDate || 0);
      return db - da;
    });
    lastAction = (sorted[0].HistoryLine || sorted[0].Status || '').trim();
  }

  return {
    has_public_hearing: hasPublicHearing,
    has_executive_session: hasExecSession,
    committee_passed: committeePassed,
    pulled_from_rules: pulledFromRules,
    held_in_rules: heldInRules,
    stalled,
    substitute_filed: substituteFiled,
    double_referral: doubleReferral,
    fiscal_referral: fiscalReferral,
    fiscal_note_size: fiscalNoteSize,
    amendment_count: amendmentCount,
    session_week: sessionWeek,
    days_since_action: daysSince,
    stage,
    days_to_cutoff: getDaysToCutoff(stage),
    avg_floor_margin: avgFloorMargin,
    hearing_date: hearingDate,
    last_action_date: lastDate.toISOString(),
    last_action: lastAction,  // Phase 5A: now populated
  };
}

// ── SPONSOR EXTRACTION ────────────────────────────────────────────────────────
function extractSponsors(sponsors) {
  if (!sponsors || sponsors.length === 0) return {
    prime_sponsor: 'Unknown', prime_party: '', majority_sponsor: false,
    bipartisan: false, cosponsor_count: 0, sponsor_tier: 4, is_committee_chair: false,
  };
  const prime = sponsors.find(s => s.Order === '1' || s.Type === 'Prime') || sponsors[0];
  const rest = sponsors.filter(s => s !== prime);
  // Use Party field from GetSponsors (returns 'D' or 'R')
  const party = prime.Party || prime.Acronym || '';
  return {
    prime_sponsor: `${prime.FirstName||''} ${prime.LastName||''}`.trim() || 'Unknown',
    prime_party: party,
    majority_sponsor: party === 'D',  // Democrats hold majority in WA 2025-28
    bipartisan: rest.some(s => (s.Party||s.Acronym||'') !== party && (s.Party||s.Acronym||'') !== ''),
    cosponsor_count: rest.length,
    sponsor_tier: party === 'D' ? 3 : 4,
    is_committee_chair: false,  // populated separately via committee roster sync
  };
}

// ── SCORING ENGINE v2 ─────────────────────────────────────────────────────────
function scoreBill(bill, categoryRates) {
  // COMMITTEE (0-25)
  let committee = 3;
  if (bill.has_public_hearing) committee += 11;
  if (bill.committee_passed) committee += 8;
  if (bill.has_executive_session && bill.committee_passed) committee += 6;
  committee = Math.max(0, Math.min(committee, 25));

  // SPONSOR (0-20) — uses full range now
  let sponsor = 4;  // base
  if (bill.majority_sponsor) sponsor += 4;
  if (bill.is_committee_chair) sponsor += 6;
  if (bill.bipartisan) sponsor += 4;
  if ((bill.cosponsor_count || 0) >= 5) sponsor += 2;
  sponsor = Math.max(0, Math.min(sponsor, 20));

  // MOMENTUM (0-20) — activity-based, not just recency
  let momentum = 0;
  // Activity level
  if (bill.stage >= 4) momentum += 5;
  else if (bill.committee_passed && bill.has_executive_session) momentum += 5;
  else if (bill.has_public_hearing && bill.committee_passed) momentum += 4;
  else if (bill.has_public_hearing) momentum += 3;
  else if (bill.has_executive_session) momentum += 3;
  // Bonus signals
  if (bill.substitute_filed) momentum += 3;
  if (bill.pulled_from_rules) momentum += 3;
  // Recency
  const days = bill.days_since_action || 0;
  if (days <= 7) momentum += 5;
  else if (days <= 14) momentum += 3;
  else if (days <= 21) momentum += 1;
  // Penalties
  if (bill.stalled) momentum -= 8;
  momentum = Math.max(0, Math.min(momentum, 20));

  // HISTORICAL (0-20) — category pass rates
  const catRate = categoryRates[bill.category] ?? 0.427;
  const baseline = categoryRates['Other'] ?? 0.427;
  let historical = Math.round(8 + ((catRate - baseline) / baseline) * 10);
  const bn = parseInt((bill.bill_number || '').replace(/\D/g, '')) || 9999;
  if (bn <= 200) historical += 2;
  else if (bn > 600) historical -= 1;
  historical = Math.max(0, Math.min(historical, 20));

  // FISCAL (0-15) — differentiated by fiscal_note_size
  const fiscalMap = { 'none': 15, 'small': 12, 'medium': 8, 'large': 4, 'very large': 1 };
  const fiscal = fiscalMap[bill.fiscal_note_size] ?? 8;

  // STAGE ADVANCEMENT BONUS — the key ceiling fix
  const stageBonus = { 1: 0, 2: 3, 3: 8, 4: 15, 5: 20, 6: 25 };
  const bonus = stageBonus[bill.stage] ?? 0;

  const base_total = committee + sponsor + momentum + historical + fiscal + bonus;

  // X FACTORS — positive and negative multipliers
  let xf = 1.0;
  const xf_factors = [];

  // Positive X factors
  if (bill.companion_bill) { xf += 0.10; xf_factors.push({ l: 'Companion bill', d: 0.10, pos: true }); }
  if (bill.substitute_filed) { xf += 0.05; xf_factors.push({ l: 'Substitute filed', d: 0.05, pos: true }); }
  if (bill.has_executive_session && bill.committee_passed) { xf += 0.06; xf_factors.push({ l: 'Exec session passed', d: 0.06, pos: true }); }
  if ((bill.stage || 1) >= 4) { xf += 0.08; xf_factors.push({ l: '2nd chamber', d: 0.08, pos: true }); }
  if (bill.pulled_from_rules) { xf += 0.15; xf_factors.push({ l: 'Pulled from Rules', d: 0.15, pos: true }); }
  if (bill.avg_floor_margin != null && bill.avg_floor_margin >= 0.75) {
    xf += 0.08; xf_factors.push({ l: 'Strong margin', d: 0.08, pos: true });
  }

  // Negative X factors
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

  // Cutoff pressure — only during active session with valid cutoff windows
  const dtc = bill.days_to_cutoff ?? 99;
  if (dtc >= 1 && dtc <= 5 && !bill.has_public_hearing && (bill.stage || 1) <= 2) {
    xf -= 0.18; xf_factors.push({ l: `Cutoff: ${dtc}d`, d: -0.18, pos: false });
  } else if (dtc >= 1 && dtc <= 14 && !bill.committee_passed && (bill.stage || 1) <= 2) {
    xf -= 0.08; xf_factors.push({ l: 'Cutoff warning', d: -0.08, pos: false });
  }

  xf = Math.round(Math.max(0.50, Math.min(1.50, xf)) * 1000) / 1000;
  const final_score = Math.min(99, Math.round(base_total * xf));  // cap at 99, save 100 for "signed into law"

  // CONFIDENCE — calibrated against actual 2025-26 session outcomes
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

// ── PROCESS SINGLE BILL ───────────────────────────────────────────────────────
async function processBill(raw, categoryRates, state) {
  const billNum = raw.BillNumber || raw.BillId?.replace(/\D/g, '');
  if (!billNum) return null;

  // Phase 5C.8: skip gubernatorial appointments (bill_number >= 9000).
  // These are not real bills and clutter the DB / burn tokens.
  const billNumInt = parseInt(billNum, 10);
  if (!isNaN(billNumInt) && billNumInt >= 9000) return null;

  const billApiId = makeBillId(raw);
  const billId = `${SESSION}-${billNum}`;

  // Phase 5C.1: Fetch the full legislation object FIRST — it contains title,
  // fiscal note flags, and sponsors that are all missing from the raw
  // LegislationInfo summary returned by GetLegislationByYear. We use this
  // single object downstream for title, fiscal_note_size, and prime_sponsor.
  const legislation = await getLegislation(billNum);

  // Phase 5C.1: Pull title from legislation object, with a fallback chain.
  const title =
    (legislation && (legislation.LongDescription || legislation.ShortDescription)) ||
    raw.ShortDescription ||
    billApiId; // e.g. "HB 1001" — still better than empty string
  const category = detectCategory(title);

  // Phase 5C.3: Extract sponsors from the legislation object (no separate API call).
  // Shape is legislation.Sponsors.Sponsor — can be an array or a single object.
  let sponsors = [];
  if (legislation?.Sponsors?.Sponsor) {
    const s = legislation.Sponsors.Sponsor;
    sponsors = Array.isArray(s) ? s : [s];
  }

  // Remaining API calls run in parallel (getSponsors call deleted).
  const [hearings, statusChanges, amendments, rollCalls] = await Promise.all([
    getHearings(billNum),
    getStatusChanges(billApiId),
    getAmendments(billNum),
    getRollCalls(billNum),
  ]);

  const features = extractFeatures(hearings, statusChanges, amendments, rollCalls, raw, state, legislation);
  const sponsorData = extractSponsors(sponsors);

  // Extract companion bill from full legislation data
  let companionBill = null;
  let committeeName = '';
  if (legislation) {
    const companions = legislation?.Companions?.Companion;
    const compArr = Array.isArray(companions) ? companions : (companions ? [companions] : []);
    if (compArr.length > 0) {
      companionBill = compArr[0].BillId || compArr[0].BillNumber || null;
    }
    // Phase 5A: Extract committee_name from CurrentStatus
    committeeName = legislation?.CurrentStatus?.Committee?.Name
      || legislation?.CurrentStatus?.Committee?.LongName
      || legislation?.CurrentStatus?.CommitteeName
      || raw.CurrentStatus?.CommitteeName
      || '';

    // Phase 5B: If still empty, extract from status change history ("referred to [Committee]")
    if (!committeeName) {
      // Look through status changes in reverse (most recent first) for referral text
      const scArr = Array.isArray(statusChanges) ? statusChanges : [];
      for (let i = scArr.length - 1; i >= 0; i--) {
        const desc = scArr[i]?.Description || scArr[i]?.HistoryLine || '';
        const match = desc.match(/[Rr]eferred to ([^.]+)\./);
        if (match) {
          committeeName = match[1].trim();
          break;
        }
      }
    }
    // Phase 5B: If still empty, try "Rules" or exec action patterns from last status change
    if (!committeeName) {
      const lastDesc = features.last_action || '';
      if (/Rules Committee|Rules "X"|Rules 2 Review/i.test(lastDesc)) {
        committeeName = 'Rules';
      } else {
        const execMatch = lastDesc.match(/^([A-Z]+) - /);
        if (execMatch) {
          const abbrevMap = {
            APP: 'Appropriations', FIN: 'Finance', TR: 'Transportation',
            AGNR: 'Agriculture & Natural Resources', SGOV: 'State Government',
            CPB: 'Consumer Protection & Business', HCW: 'Health Care & Wellness',
            TEDV: 'Trade & Economic Development', PEW: 'Postsecondary Education & Workforce',
            CB: 'College & Budget', CRJ: 'Civil Rights & Judiciary', HSG: 'Housing',
            HUSR: 'Human Services', ENET: 'Environment, Energy & Technology',
            HLTC: 'Health & Long-Term Care', LJ: 'Law & Justice',
            EDUC: 'Early Learning & K-12 Education', LC: 'Labor & Commerce',
            LWS: 'Labor & Workplace Standards', LGOV: 'Local Government',
          };
          committeeName = abbrevMap[execMatch[1]] || '';
        }
      }
    }
  }

  const billRecord = {
    bill_id: billId,
    bill_number: billNum,
    session: SESSION,
    chamber: raw.OriginalAgency || raw.Agency || 'House',
    title: title.slice(0, 200),
    category,
    status: raw.CurrentStatus?.Status || 'Introduced',
    committee_name: committeeName,  // Phase 5A: now populated from GetLegislation
    bill_number_seq: parseInt(billNum) || 9999,
    companion_bill: companionBill,
    last_action: features.last_action,  // Phase 5A: now populated from status changes
    ...sponsorData,
    ...features,
    raw_data: {
      summary: raw,
      hearings_count: hearings.length,
      status_changes: statusChanges.length,
      amendments_count: amendments.length,
      rollcalls_count: rollCalls.length,
    },
    updated_at: new Date().toISOString(),
  };

  // Score with calibrated rates
  const scores = scoreBill(billRecord, categoryRates);
  billRecord.trajectory_score = scores.base_total;
  billRecord.final_score = scores.final_score;
  billRecord.xf_multiplier = scores.xf_multiplier;
  billRecord.pass_probability = scores.pass_prob;
  billRecord.confidence_label = scores.conf_label;
  billRecord.confidence_low = scores.conf_low;
  billRecord.confidence_high = scores.conf_high;

  return { billRecord, scores };
}

// ── MAIN SYNC ─────────────────────────────────────────────────────────────────
async function runSync() {
  const startTime = Date.now();
  const state = getSessionState();
  const today = new Date().toISOString().split('T')[0];
  let billsFetched = 0, billsUpdated = 0, snapshotsWritten = 0;
  const errors = [];

  console.log(`[${new Date().toISOString()}] Sync v2.2 — ${SESSION} — state: ${state}`);

  const calibration = await loadCalibratedWeights();
  const categoryRates = calibration.category_rates || getHardcodedWeights().category_rates;

  let allBills;
  try {
    allBills = await getAllBillsSummary();
    billsFetched = allBills.length;
    console.log(`  Fetched ${billsFetched} bills`);
  } catch(e) {
    console.error('  WA API unavailable:', e.message);
    await supabase.from('sync_log').insert({
      session: SESSION, bills_fetched: 0, bills_updated: 0,
      snapshots_written: 0, errors: [{ err: e.message }],
      duration_ms: Date.now() - startTime, notes: 'Aborted — WA API error',
    });
    return;
  }

  // Phase 5A: Increased batch size to 10 (from 5) + shorter delay
  const BATCH = 10;
  for (let i = 0; i < allBills.length; i += BATCH) {
    const batch = allBills.slice(i, i + BATCH);

    // Progress every 50 bills (less console noise)
    if (i % 50 === 0 || i === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  [${elapsed}s] Processing ${i}–${Math.min(i+BATCH, allBills.length)} of ${allBills.length}...`);
    }

    await Promise.all(batch.map(async raw => {
      try {
        const result = await processBill(raw, categoryRates, state);
        if (!result) return;
        const { billRecord, scores } = result;

        const { error: uErr } = await supabase
          .from('bills')
          .upsert(billRecord, { onConflict: 'bill_id' });
        if (uErr) { errors.push({ bill: billRecord.bill_number, err: uErr.message }); return; }

        const { error: sErr } = await supabase
          .from('trajectory_snapshots')
          .upsert({
            bill_id: billRecord.bill_id,
            session: SESSION,
            score: scores.final_score,
            base_total: scores.base_total,
            xf_multiplier: scores.xf_multiplier,
            stage: billRecord.stage,
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
        else errors.push({ bill: billRecord.bill_number, err: `snap: ${sErr.message}` });
        billsUpdated++;
      } catch(e) {
        errors.push({ bill: raw.BillNumber, err: e.message });
      }
    }));

    // Phase 5A: Shorter delay between batches (was 2000ms)
    if (i + BATCH < allBills.length) await new Promise(r => setTimeout(r, 500));
  }

  const duration = Date.now() - startTime;
  const mins = (duration / 60000).toFixed(1);
  console.log(`\n  Done: ${billsFetched} fetched, ${billsUpdated} updated, ${snapshotsWritten} snapshots, ${errors.length} errors (${mins} min)`);

  await supabase.from('sync_log').insert({
    session: SESSION, bills_fetched: billsFetched, bills_updated: billsUpdated,
    snapshots_written: snapshotsWritten,
    errors: errors.length ? errors.slice(0, 50) : null,
    duration_ms: duration,
    notes: `sync-v2.2 Phase 5A — retry/timeout/committee/action`,
  });

  return { billsFetched, billsUpdated, snapshotsWritten, errors };
}

module.exports = { runSync, processBill, scoreBill };

if (require.main === module) {
  runSync().catch(console.error);
}
