/**
 * VECTOR | WA — Sync Script v2.6 (Phase 7D.2b — Substitute Bill Fix)
 * lib/sync-v2.js
 *
 * Fetches all WA Legislature bills, scores them with the calibrated
 * trajectory model, and writes results to Supabase.
 *
 * v2.6 CHANGES (Phase 7D.2b):
 *  - 7D.2b.1: getLegislation() now picks the most advanced version (highest
 *             SubstituteVersion/EngrossedVersion) instead of arr[0]. This gives
 *             us the correct BillId (e.g. "SHB 1294") and accurate CurrentStatus.
 *  - 7D.2b.2: processBill() uses the advanced version's BillId for
 *             getStatusChanges() — fixes truncated histories for ~580 substituted
 *             bills that were stuck at stage 3 with "substitute bill substituted."
 *  - 7D.2b.3: substitute_filed detection now checks status text for
 *             "substitute bill substituted" (was always false for most bills).
 *  - 7D.2b.4: Cleaned up duplicate governor_action + outcome boolean lines.
 *
 * v2.5 CHANGES (Phase 7D.1):
 *  - 7D.1.1: Fixed governor-signed detection — API returns "Governor signed."
 *            not "signed by governor". Was missing ~65% of enacted laws.
 *  - 7D.1.2: Added governor_action column (signed/vetoed/partial_veto/null)
 *  - 7D.1.3: Added legislation_type column from WSL ShortLegislationType
 *  - 7D.1.4: Added introduction_year column from GetLegislationByYear year param
 *  - 7D.1.5: outcome_passed_law / outcome_passed_chamber now set every sync
 *            (was one-time backfill — 128 stage-6 bills had null)
 *
 * v2.4 CHANGES (Phase 6A):
 *  - 6A.1: Interim score freeze — skip rescoring when no material data changed
 *  - 6A.4: End-of-session stalled detection for stage-1 bills
 *  - 6A.5: signal_tier column — always stores score-based tier alongside outcome label
 *
 * v2.3 CHANGES (Step 6.13):
 *  - 6.13.1: Stalled detection now catches Rules-queue bills (was 82 false positives)
 *  - 6.13.2: Session-state awareness — interim bills show DEAD/CARRY OVER/LAW
 *  - 6.13.3: Added LOW confidence tier (bridge between MODERATE and VERY LOW)
 *  - 6.13.4: Hearing detection from status text as fallback to GetHearings API
 *  - 6.13.5: Graceful null handling for committee_name in UI
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

// 6L.3: Fallback defaults so sync doesn't break if GitHub Actions env vars aren't updated for 2027
// When adding a new biennium, update the fallback values here to match session-config.js
const BIENNIUM = process.env.CURRENT_BIENNIUM || '2025-26';   // e.g. '2027-28'
const YEAR     = process.env.CURRENT_YEAR     || '2026';      // e.g. '2027'
const SESSION  = `${parseInt(YEAR)-1}-${YEAR}`;               // e.g. '2025-2026'

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
  // Recalibrated after Step 6.14 category expansion (April 7, 2026 — 3,411 bills, 14 categories)
  // law_rate = became-law / total-in-bucket
  return {
    category_rates: {
      "Natural Resources": 0.195, "Government Operations": 0.098, "Agriculture": 0.098,
      "Employment / Labor": 0.096, "Transportation": 0.092, "Veterans / Military": 0.070,
      "Business / Commerce": 0.068, "Health": 0.062, "Environment": 0.054,
      "Housing": 0.052, "Budget / Appropriations": 0.046, "Other": 0.045,
      "Criminal Justice": 0.044, "Technology": 0.036, "Education": 0.034,
    },
    bucket_pass_rates: {
      "0-30": 0.000, "30-45": 0.000, "45-60": 0.000,
      "60-75": 0.013, "75-100": 0.694,
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
  // FIX: Fetch BOTH years of the biennium.
  // GetLegislationByYear returns bills by the year they were INTRODUCED.
  // A biennium like '2025-26' has 2025 introductions + 2026 introductions.
  // Previously only fetching YEAR (2026), missing the entire 2025 long session.
  const bienniumStart = BIENNIUM.split('-')[0];            // e.g. '2025'
  const bienniumEnd   = '20' + BIENNIUM.split('-')[1];     // e.g. '2026'
  const years = [bienniumStart, bienniumEnd];

  const toArr = x => { const v = x?.ArrayOfLegislationInfo?.LegislationInfo; return Array.isArray(v) ? v : (v ? [v] : []); };
  const all = [];

  for (const yr of years) {
    const [h, s] = await Promise.all([
      fetchXML('LegislationService.asmx', 'GetLegislationByYear', { year: yr, biennium: BIENNIUM, agency: 'House' }),
      fetchXML('LegislationService.asmx', 'GetLegislationByYear', { year: yr, biennium: BIENNIUM, agency: 'Senate' }),
    ]);
    // Phase 7D.1: Tag each bill with its introduction year
    const hArr = toArr(h).map(b => ({ ...b, _introYear: parseInt(yr) }));
    const sArr = toArr(s).map(b => ({ ...b, _introYear: parseInt(yr) }));
    all.push(...hArr, ...sArr);
    console.log(`  Year ${yr}: ${hArr.length} House + ${sArr.length} Senate bills`);
  }

  // Deduplicate by BillNumber+Agency in case any bill appears in both years
  const seen = new Set();
  return all.filter(b => {
    const key = `${b.OriginalAgency || b.Agency}_${b.BillNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

// Phase 5C.3 (revised) — GetLegislation does NOT return a Sponsors collection
// (only a last-name string in parens). So we still need a per-bill call to
// LegislationService.asmx/GetSponsors, which returns the full roster with
// FirstName, LastName, Type ('Primary'/'Secondary'), and Order (0-indexed).
async function getSponsors(billId) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetSponsors', { biennium: BIENNIUM, billId });
    const items = data?.ArrayOfSponsor?.Sponsor;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  } catch(e) { return []; }
}

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
// Phase 7D.2b FIX: GetLegislation returns ALL versions of a bill (original +
// substitutes + engrossments). We pick the most advanced version — the one with
// the highest SubstituteVersion (then EngrossedVersion as tiebreak). This gives
// us the correct BillId (e.g. "SHB 1294") for querying status changes, plus
// the accurate CurrentStatus showing governor signing instead of substitution.
async function getLegislation(billNumber) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetLegislation', { biennium: BIENNIUM, billNumber });
    const items = data?.ArrayOfLegislation?.Legislation;
    const arr = Array.isArray(items) ? items : (items ? [items] : []);
    if (arr.length <= 1) return arr[0] || null;
    // Pick the most advanced version (highest substitute + engrossed)
    return arr.reduce((best, cur) => {
      const bestSub = parseInt(best.SubstituteVersion || '0');
      const curSub  = parseInt(cur.SubstituteVersion || '0');
      const bestEng = parseInt(best.EngrossedVersion || '0');
      const curEng  = parseInt(cur.EngrossedVersion || '0');
      return (curSub > bestSub || (curSub === bestSub && curEng > bestEng)) ? cur : best;
    });
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
// v2.4 (Step 6.14): Expanded from 11 to 14 categories, ~160 keywords.
// Goal: drop "Other" from 50% to <30%. Order matters — first match wins.
// More-specific categories listed before broader ones to avoid false positives.
function detectCategory(title = '') {
  const t = title.toLowerCase();
  const CATS = {
    'Veterans / Military':  ['veteran','military','armed forces','national guard','service member','medal of honor','purple heart'],
    'Natural Resources':    ['water right','timber','mining','mineral','fishery','fisheries','wildlife manag','hatchery','shellfish','aquatic','irrigation','reclamation','wildland'],
    'Health':               ['health','medical','hospital','medicaid','medicare','mental health','substance','disease','pharmacy','abortion','reproductive','prescri','prosthetic','hiv','dental','opioid','fentanyl','behavioral health','therapy','therapist','nursing home','assisted living','long-term care','aging','elder','senior','dementia','developmental disabilit','intellectual disabilit','autism'],
    'Education':            ['school','education','student','teacher','university','college','curriculum','child care','childcare','early childhood','preschool','ninth grade','postsecondary','k-12','tuition','financial aid','scholarship','literacy','special education'],
    'Criminal Justice':     ['criminal','police','law enforcement','felony','misdemeanor','sentencing','jail','prison','offense','court','judge','judicial','attorney','public defense','public safety','victim','domestic violence','sex offend','trafficking','assault','robbery','theft','fraud','corrections','parole','probation','restitution','firearm','gun','weapon','ammunition','body cam','community safety'],
    'Housing':              ['housing','tenant','landlord','rent ','zoning','eviction','homeless','dwelling','accessory dwelling','building code','condominium','condo','mortgage','affordable housing','residential develop','shelter','mobile home','manufactured home'],
    'Environment':          ['environment','climate','carbon','emission','pollution','water quality','salmon','forest','energy','electric','nuclear','solar','wind power','renewable','wildfire','clean air','clean fuel','recycling','composting','waste','hazardous','toxic','superfund','shoreline','wetland','endangered species'],
    'Government Operations':['election','voter','ballot','campaign','redistrict','public record','disclosure','transparency','open meeting','public facilities','state agenc','county','municipal','local govern','city council','commission on','public employ','civil service','notary','lobbyist','ethics in public','initiative','referendum','tribal','native american','indian tribe'],
    'Technology':           ['technology','data','privacy','cybersecurity','artificial intelligence','digital','broadband','internet','telecom','blockchain','autonomous vehicle','drone','surveillance'],
    'Budget / Appropriations':['appropriat','budget','general fund','fiscal','revenue','tax credit','sales tax','property tax','excise tax','B&O tax','income tax','capital gains','estate tax','levy','assessment','exemption','tax incentive','tax preference','tax reform','tax relief','tax exempt','reducing','state propert'],
    'Employment / Labor':   ['employee','employer','wage','labor','worker','employment','unemployment','workplace','pension','retirement','paid leave','family leave','paid family','collective bargain','workforce','apprentice','occupational','prevailing wage','compensation'],
    'Transportation':       ['transport','highway','road','transit','vehicle','ferry','traffic','rail ','railroad','aviation','airport','bicycle','pedestrian','speed limit','driver','trucking','freight','port ','maritime'],
    'Agriculture':          ['agricultur','farm','crop','livestock','irrigation','pesticide','animal','veterinar','poultry','dairy','organic','food safety','food processing','hemp'],
    'Business / Commerce':  ['business','commerce','corporation','license','contract','trade','insurance','consumer','debt','credit','loan ','pawnbroker','antitrust','cannabis','marijuana','liquor','alcohol','real estate','gaming','gambling','lottery','regulation of','small business','retail','wholesale','franchise'],
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
  // 6.13.4: Detect hearings from BOTH the GetHearings API AND status change text.
  // The API may miss some hearings; status text catches "public hearing in..." lines.
  const hasHearingFromAPI = hearings.length > 0;

  const sortedHearings = hearings
    .filter(h => h.CommitteeMeeting?.Date)
    .sort((a,b) => new Date(a.CommitteeMeeting.Date) - new Date(b.CommitteeMeeting.Date));
  let hearingDate = sortedHearings.length > 0
    ? new Date(sortedHearings[0].CommitteeMeeting.Date).toISOString().split('T')[0]
    : null;

  // Fallback: detect hearing from status change text
  const hasHearingFromStatus = statusChanges.some(s => {
    const line = (s.HistoryLine || s.Status || '').toLowerCase();
    return line.includes('public hearing') || line.includes('scheduled for public hearing');
  });

  // If status text found a hearing but API didn't, try to extract the date
  if (!hearingDate && hasHearingFromStatus) {
    const hearingSC = statusChanges.find(s => {
      const line = (s.HistoryLine || s.Status || '').toLowerCase();
      return line.includes('public hearing');
    });
    if (hearingSC) {
      const d = new Date(hearingSC.ActionDate || hearingSC.StatusDate || '');
      if (!isNaN(d)) hearingDate = d.toISOString().split('T')[0];
    }
  }

  const statusTexts = statusChanges.map(s => (s.HistoryLine || s.Status || '').toLowerCase());
  const joined = statusTexts.join(' ');

  const hasExecSession = joined.includes('executive action') ||
    (joined.includes('executive session') && !joined.includes('no action'));
  const committeePassed = statusTexts.some(s => s.includes('do pass') && !s.includes('minority'));
  const pulledFromRules = joined.includes('rules committee relieved') || joined.includes('removed from rules');
  const heldInRules = joined.includes('held') && joined.includes('rules') && !pulledFromRules;
  const passedFloor = joined.includes('third reading, passed') || joined.includes('passed third reading');
  const passedOpposite = joined.includes('passed to senate') || joined.includes('passed to house') || joined.includes('delivered to governor');
  // Phase 7D.1 FIX: WSL API returns "Governor signed." not "signed by governor"
  // Old check missed ~65% of laws. Now matches both word orders + veto variants.
  const signedByGov = joined.includes('governor signed') || joined.includes('signed by governor') || joined.includes('effective date') || joined.includes('chaptered');
  const vetoedByGov = joined.includes('governor vetoed') || joined.includes('vetoed by governor');
  const partialVeto = joined.includes('governor partially vetoed') || joined.includes('partially vetoed by governor');

  // Phase 7D.1: governor_action — signed trumps partial_veto trumps vetoed
  let governorAction = null;
  if (signedByGov) governorAction = 'signed';
  if (partialVeto) governorAction = 'partial_veto';
  if (vetoedByGov && !partialVeto) governorAction = 'vetoed';

  // 6.13.4 FIX: GetHearings API returns 0 for all bills, and WA status
  // changes don't include "public hearing" events (hearings are tracked in
  // CommitteeMeetingService, not as legislative status changes). Infer from
  // downstream signals: if a bill had exec session or passed committee, it
  // definitely had a public hearing first — WA rules require it.
  const hasPublicHearing = hasHearingFromAPI || hasHearingFromStatus
    || hasExecSession || committeePassed;

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

  // Substitute detection — from amendments, raw API data, AND status text
  // Phase 7D.2b FIX: Also check status change text for "substitute bill substituted"
  // which is the definitive signal that a substitute was adopted. The amendment check
  // alone was always returning false for most bills.
  const substituteFiled = amendments.some(a =>
    (a.AmendmentType || a.Description || '').toLowerCase().includes('substitute'))
    || parseInt(raw.SubstituteVersion || '0') > 0
    || statusTexts.some(s => s.includes('substitute bill substituted'));
  const amendmentCount = amendments.length;

  const allDates = statusChanges
    .map(s => new Date(s.ActionDate || s.StatusDate || ''))
    .filter(d => !isNaN(d));
  const lastDate = allDates.length ? new Date(Math.max(...allDates)) : new Date();
  const daysSince = Math.floor((new Date() - lastDate) / 86400000);

  // Stalled detection — catches both committee-stage AND Rules-queue bills
  // Rules bills HAVE passed committee (committeePassed=true, stage=3) but can
  // sit in the Rules queue for months with no action. Derive committee name
  // from the legislation object to check for "rules".
  const leg2 = legislation || {};
  const cmteForStalled = (
    leg2?.CurrentStatus?.Committee?.Name
    || leg2?.CurrentStatus?.Committee?.LongName
    || leg2?.CurrentStatus?.CommitteeName
    || ''
  ).toLowerCase();
  const isInRulesQueue = cmteForStalled.includes('rules') && stage === 3;
  const stalled = daysSince > 21 && stage <= 3 && (!committeePassed || isInRulesQueue);

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
    governor_action: governorAction,  // Phase 7D.1: signed/vetoed/partial_veto/null
  };
}

// ── PARTY ENRICHMENT (Phase 6.11) ────────────────────────────────────────────
// The per-bill LegislationService/GetSponsors does NOT include a Party field.
// SponsorService.asmx/GetSponsors returns the biennium-wide legislator roster
// and DOES include Party. We call it once at the top of runSync() and build an
// in-memory Map<sponsorId, 'D'|'R'|''> passed into every extractSponsors() call.
// Graceful degradation: if this call fails, sync still succeeds — party stays empty.
async function fetchBienniumSponsorParties() {
  try {
    const data = await fetchXML('SponsorService.asmx', 'GetSponsors', { biennium: BIENNIUM });
    const items = data?.ArrayOfMember?.Member
               ?? data?.ArrayOfSponsor?.Sponsor
               ?? data?.ArrayOfLegislator?.Legislator;
    if (!items) return new Map();
    const arr = Array.isArray(items) ? items : [items];
    const map = new Map();
    for (const m of arr) {
      const id = m.Id || m.MemberId || m.SponsorId;
      let party = (m.Party || '').trim();
      if (party.toLowerCase().startsWith('d')) party = 'D';
      else if (party.toLowerCase().startsWith('r')) party = 'R';
      else party = '';
      if (id) map.set(String(id), party);
    }
    return map;
  } catch(e) {
    console.warn(`  [party-map] fetch failed: ${e.message} — continuing without party enrichment`);
    return new Map();
  }
}

// ── SPONSOR EXTRACTION ────────────────────────────────────────────────────────
function extractSponsors(sponsors, partyMap) {
  if (!sponsors || sponsors.length === 0) return {
    prime_sponsor: 'Unknown', prime_party: '', majority_sponsor: false,
    bipartisan: false, cosponsor_count: 0, sponsor_tier: 4, is_committee_chair: false,
  };

  // Phase 6.11 — Enrich each sponsor's Party from the biennium-wide roster map
  // BEFORE primary detection runs.
  if (partyMap && partyMap.size > 0) {
    for (const s of sponsors) {
      if (!s.Party || s.Party === '') {
        const id = s.Id || s.SponsorId || s.MemberId;
        if (id) {
          const p = partyMap.get(String(id));
          if (p) s.Party = p;
        }
      }
    }
  }

  // Phase 5C.3 fix: Primary/Secondary (not Prime), Order is 0-indexed (not '1'-based)
  const prime = sponsors.find(s => s.Type === 'Primary' || s.Order === '0') || sponsors[0];
  const rest = sponsors.filter(s => s !== prime);
  const party = prime.Party || '';
  const fullName = `${prime.FirstName||''} ${prime.LastName||''}`.trim()
                   || prime.Name
                   || 'Unknown';
  return {
    prime_sponsor: fullName,
    prime_party: party,
    majority_sponsor: party === 'D',  // Democrats hold majority in WA 2025-28
    bipartisan: rest.some(s => (s.Party||'') !== party && (s.Party||'') !== ''),
    cosponsor_count: rest.length,
    sponsor_tier: party === 'D' ? 3 : 4,
    is_committee_chair: false,  // populated separately via committee roster sync
  };
}

// ── SCORING ENGINE v2 ─────────────────────────────────────────────────────────
function scoreBill(bill, categoryRates, sessionState) {
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

  // CONFIDENCE — recalibrated against FULL 2025-26 biennium (April 8, 2026 — 3,411 bills, 196 LAW)
  // pass_prob = "probability of becoming law" based on actual became-law rates per bucket
  let pass_prob, conf_label, conf_low, conf_high;

  // 6.13.2: SESSION-STATE AWARENESS — once sine die hits, bills that didn't
  // pass are dead. Stage 6 (signed) keeps its score. Stage 4-5 carry over
  // within a biennium. Everything else is dead until next session.
  const isInterim = sessionState === 'interim' || sessionState === 'pre_filing';

  if (isInterim && bill.stage >= 6) {
    // Signed into law — terminal success
    pass_prob = 1.000; conf_label = 'LAW'; conf_low = 1.000; conf_high = 1.000;
  } else if (isInterim && bill.stage >= 4) {
    // Passed at least one chamber but biennium is over — these bills are done
    pass_prob = 0.000; conf_label = 'CARRY OVER'; conf_low = 0.000; conf_high = 0.000;
  } else if (isInterim && bill.stage < 4) {
    // Didn't make it out — dead for now
    pass_prob = 0.000; conf_label = 'DEAD'; conf_low = 0.000; conf_high = 0.000;
  } else if (bill.stalled || bill.held_in_rules) {
    pass_prob = 0.005; conf_label = 'VERY LOW'; conf_low = 0.000; conf_high = 0.015;
  } else if (final_score >= 75) {
    // 69.4% of 75+ bills became law (188/271)
    pass_prob = 0.694; conf_label = 'HIGH'; conf_low = 0.640; conf_high = 0.750;
  } else if (final_score >= 60) {
    // 1.3% of 60-74 bills became law (8/604)
    pass_prob = 0.013; conf_label = 'MODERATE'; conf_low = 0.004; conf_high = 0.026;
  } else if (final_score >= 45 && bill.committee_passed) {
    // 6.13.3: LOW tier — passed committee but stalled pre-floor (alive but stuck)
    // 0% became law in 45-59 bucket, but 0.8% passed a chamber — tiny nonzero signal
    pass_prob = 0.008; conf_label = 'LOW'; conf_low = 0.000; conf_high = 0.020;
  } else if (final_score >= 45) {
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
async function processBill(raw, categoryRates, state, partyMap) {
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

  // Phase 7D.2b FIX: Use the advanced version's BillId (e.g. "SHB 1294") for
  // status changes. The WSL API tracks all post-substitution events under the
  // substitute ID. Without this, status history is truncated at "substitute bill
  // substituted." — no floor votes, no opposite chamber, no governor signing.
  const advancedBillId = legislation?.BillId || billApiId;

  // Phase 5C.3 (revised): GetLegislation's Sponsor field is just a string like
  // "(Abbarno)", not a collection. Call LegislationService/GetSponsors for the
  // real list with FirstName/LastName/Type/Order.
  const [sponsors, hearings, statusChanges, amendments, rollCalls] = await Promise.all([
    getSponsors(billApiId),
    getHearings(billNum),
    getStatusChanges(advancedBillId),
    getAmendments(billNum),
    getRollCalls(billNum),
  ]);

  const features = extractFeatures(hearings, statusChanges, amendments, rollCalls, raw, state, legislation);
  const sponsorData = extractSponsors(sponsors, partyMap);

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

  // Phase 7D.1: Extract legislation_type from ShortLegislationType (nested object from xml2js)
  const shortLegType = (raw.ShortLegislationType?.ShortLegislationType || '').toUpperCase();
  const legTypeMap = { B: 'bill', R: 'resolution', JR: 'joint_resolution', JM: 'joint_memorial', CR: 'concurrent_resolution', GA: 'gubernatorial_appointment', I: 'initiative' };
  const legislationType = legTypeMap[shortLegType] || null;

  // Phase 7D.1: introduction_year tagged by getAllBillsSummary
  const introductionYear = raw._introYear || null;

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
    legislation_type: legislationType,          // Phase 7D.1
    introduction_year: introductionYear,        // Phase 7D.1
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

  // 6.13.1 FIX: extractFeatures reads committee from the legislation object,
  // but for many bills that call returns null and the committee_name is set
  // via status-change fallback above. Re-check stalled using the resolved name.
  if (!billRecord.stalled && committeeName.toLowerCase().includes('rules')
      && billRecord.stage === 3 && (billRecord.days_since_action || 0) > 21) {
    billRecord.stalled = true;
  }

  // 6A.4: End-of-session stalled detection — any bill at stage 1 that never
  // passed committee is dead once the session ends. Catches the 372 false-active bills.
  if (state === 'interim' && !billRecord.stalled
      && billRecord.stage <= 1 && !billRecord.committee_passed) {
    billRecord.stalled = true;
  }

  // Score with calibrated rates + session state awareness (6.13.2)
  const scores = scoreBill(billRecord, categoryRates, state);
  billRecord.trajectory_score = scores.base_total;
  billRecord.final_score = scores.final_score;
  billRecord.xf_multiplier = scores.xf_multiplier;
  billRecord.pass_probability = scores.pass_prob;
  billRecord.confidence_label = scores.conf_label;
  billRecord.confidence_low = scores.conf_low;
  billRecord.confidence_high = scores.conf_high;

  // Phase 7D.1: Always set outcome booleans from stage (was previously a one-time backfill)
  billRecord.outcome_passed_chamber = billRecord.stage >= 4;
  billRecord.outcome_passed_law = billRecord.stage >= 6;

  // Outcome label — human-readable final status
  const cmteName = (billRecord.committee_name || '').toLowerCase();
  const isRulesQueue = cmteName.includes('rules');
  if (billRecord.stage >= 6) {
    billRecord.outcome_label = 'Signed into Law';
  } else if (billRecord.stage >= 5) {
    billRecord.outcome_label = 'Passed Both Chambers';
  } else if (billRecord.stage >= 4) {
    billRecord.outcome_label = 'Passed Chamber of Origin';
  } else if (billRecord.stage >= 3 && isRulesQueue) {
    billRecord.outcome_label = 'Died in Rules';
  } else if (billRecord.stage >= 3) {
    billRecord.outcome_label = 'Passed Committee';
  } else if (billRecord.stage >= 2) {
    billRecord.outcome_label = 'Had Hearing';
  } else {
    billRecord.outcome_label = 'Died in Committee';
  }

  return { billRecord, scores };
}

// ── MAIN SYNC ─────────────────────────────────────────────────────────────────
async function runSync() {
  const startTime = Date.now();
  const state = getSessionState();
  const today = new Date().toISOString().split('T')[0];
  let billsFetched = 0, billsUpdated = 0, snapshotsWritten = 0, billsSkipped = 0;
  const errors = [];

  console.log(`[${new Date().toISOString()}] Sync v2.6 — ${SESSION} — state: ${state}`);

  // 6A.1: During interim, pre-load existing bills so we can detect material changes
  let existingBillsMap = null;
  if (state === 'interim') {
    console.log('  INTERIM MODE — will only rescore bills with material data changes');
    existingBillsMap = new Map();
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data, error: pgErr } = await supabase
        .from('bills')
        .select('bill_id, stage, committee_passed, has_public_hearing, stalled, held_in_rules, last_action')
        .eq('session', SESSION)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (pgErr || !data || data.length === 0) break;
      data.forEach(b => existingBillsMap.set(b.bill_id, b));
      if (data.length < PAGE_SIZE) break;
      page++;
    }
    console.log(`  Loaded ${existingBillsMap.size} existing bills for change detection`);
  }

  const calibration = await loadCalibratedWeights();
  const categoryRates = calibration.category_rates || getHardcodedWeights().category_rates;

  // Phase 6.11: Party enrichment — one-shot biennium-wide roster fetch
  const partyMap = await fetchBienniumSponsorParties();
  console.log(`  Loaded party map: ${partyMap.size} sponsors`);

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
        const result = await processBill(raw, categoryRates, state, partyMap);
        if (!result) return;
        const { billRecord, scores } = result;

        // 6A.1: INTERIM FREEZE — skip rescoring if nothing material changed
        if (existingBillsMap) {
          const existing = existingBillsMap.get(billRecord.bill_id);
          if (existing) {
            const materialChange =
              existing.stage !== billRecord.stage ||
              existing.committee_passed !== billRecord.committee_passed ||
              existing.has_public_hearing !== billRecord.has_public_hearing ||
              existing.stalled !== billRecord.stalled ||
              existing.held_in_rules !== billRecord.held_in_rules ||
              existing.last_action !== billRecord.last_action;
            if (!materialChange) {
              billsSkipped++;
              return; // No change — keep existing scores
            }
            console.log(`  ** Material change detected: ${billRecord.bill_number} (${billRecord.bill_id})`);
          }
        }

        // 6A.5: Always compute score-based signal_tier alongside outcome labels
        let signal_tier;
        if (scores.final_score >= 75) signal_tier = 'HIGH';
        else if (scores.final_score >= 60) signal_tier = 'MODERATE';
        else if (scores.final_score >= 45) signal_tier = 'LOW';
        else signal_tier = 'VERY LOW';
        billRecord.signal_tier = signal_tier;

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
  console.log(`\n  Done: ${billsFetched} fetched, ${billsUpdated} updated, ${billsSkipped} skipped (unchanged), ${snapshotsWritten} snapshots, ${errors.length} errors (${mins} min)`);

  await supabase.from('sync_log').insert({
    session: SESSION, bills_fetched: billsFetched, bills_updated: billsUpdated,
    snapshots_written: snapshotsWritten,
    errors: errors.length ? errors.slice(0, 50) : null,
    duration_ms: duration,
    notes: `sync-v2.6 Phase 7D.2b — substitute bill fix${billsSkipped > 0 ? ` (${billsSkipped} unchanged, skipped)` : ''}`,
  });

  return { billsFetched, billsUpdated, snapshotsWritten, errors };
}

module.exports = { runSync, processBill, scoreBill };

if (require.main === module) {
  runSync().catch(console.error);
}
