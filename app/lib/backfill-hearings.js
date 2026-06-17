/**
 * VECTOR | WA — Hearings Backfill Script (Step 6C.1)
 *
 * Fetches hearing data from the WSL CommitteeMeetingService API
 * using the BULK committee meeting approach (per-bill GetHearings returns 0).
 *
 * Strategy:
 *  1. Get all active committees for both House and Senate
 *  2. For each committee, fetch all meetings for the biennium
 *  3. Each meeting has agenda items that list bill numbers heard
 *  4. Insert into hearings table + backfill bills.hearing_date
 *
 * Run locally: node backfill-hearings.js
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY env vars (or .env file)
 */

import { createClient } from '@supabase/supabase-js';
import xml2js from 'xml2js';

// ── CONFIG ───────────────────────────────────────────────────────────────────
const WA_BASE   = 'https://wslwebservices.leg.wa.gov';
const BIENNIUM  = '2025-26';
const SESSION   = '2025-2026';
const API_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://skuedssejrbrxycgdcfw.supabase.co',
  process.env.SUPABASE_SERVICE_KEY,
);

// ── HELPERS ──────────────────────────────────────────────────────────────────
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { 'Accept': 'text/xml' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${retries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function fetchXML(service, endpoint, params) {
  const url = new URL(`${WA_BASE}/${service}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetchWithRetry(url.toString());
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
  return parser.parseStringPromise(text);
}

function toArr(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// ── STEP 1: GET ALL COMMITTEES ───────────────────────────────────────────────
async function getActiveCommittees(agency) {
  console.log(`Fetching ${agency} committees...`);
  const data = await fetchXML('CommitteeService.asmx', 'GetActiveCommittees', {
    biennium: BIENNIUM,
    agency,
  });
  const items = toArr(data?.ArrayOfCommittee?.Committee);
  console.log(`  Found ${items.length} ${agency} committees`);
  return items;
}

// ── STEP 2: GET MEETINGS FOR EACH COMMITTEE ──────────────────────────────────
async function getCommitteeMeetings(agency, committeeName) {
  try {
    // Try GetCommitteeMeetings endpoint
    const data = await fetchXML('CommitteeMeetingService.asmx', 'GetCommitteeMeetings', {
      biennium: BIENNIUM,
      agency,
      committeeName,
      beginDate: '2025-01-01',
      endDate: '2026-12-31',
    });
    return toArr(data?.ArrayOfCommitteeMeeting?.CommitteeMeeting);
  } catch (e) {
    console.log(`  Warning: GetCommitteeMeetings failed for ${committeeName}: ${e.message}`);
    return [];
  }
}

// ── STEP 3: EXTRACT BILL HEARINGS FROM MEETING AGENDAS ──────────────────────
function extractHearingsFromMeetings(meetings, committeeName) {
  const hearings = [];
  for (const meeting of meetings) {
    const date = meeting.Date || meeting.MeetingDate;
    const location = meeting.Room || meeting.Location || '';
    if (!date) continue;

    // Meeting agendas list bill items
    const agendaItems = toArr(meeting.AgendaItems?.AgendaItem)
      .concat(toArr(meeting.Agenda?.AgendaItem));

    for (const item of agendaItems) {
      const billNum = item.BillId || item.BillNumber || '';
      // Extract just the number (e.g. "HB 1001" -> "1001", "SB 5001" -> "5001")
      const num = billNum.replace(/[^0-9]/g, '');
      if (!num || parseInt(num) >= 9000) continue; // skip resolutions & gubernatorial

      hearings.push({
        bill_number: num,
        committee_name: committeeName,
        hearing_date: new Date(date).toISOString(),
        location: location,
        session: SESSION,
      });
    }
  }
  return hearings;
}

// ── STEP 4: LOAD BILL MAP FROM DB ───────────────────────────────────────────
async function loadBillMap() {
  console.log('Loading bill_id map from database...');
  const allBills = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number')
      .eq('session', SESSION)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    allBills.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  Loaded ${allBills.length} bills`);
  // Map bill_number -> bill_id
  const map = {};
  for (const b of allBills) {
    map[b.bill_number] = b.bill_id;
  }
  return map;
}

// ── STEP 5: INSERT HEARINGS + BACKFILL DATES ─────────────────────────────────
async function insertHearings(hearings, billMap) {
  let inserted = 0;
  let skipped = 0;
  const batch = [];

  for (const h of hearings) {
    const billId = billMap[h.bill_number];
    if (!billId) { skipped++; continue; }

    batch.push({
      bill_id: billId,
      committee_name: h.committee_name,
      hearing_date: h.hearing_date,
      location: h.location,
      session: h.session,
    });
  }

  // Deduplicate: same bill + same date = same hearing
  const seen = new Set();
  const unique = batch.filter(h => {
    const key = `${h.bill_id}_${h.hearing_date.split('T')[0]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nInserting ${unique.length} unique hearings (${skipped} skipped — no matching bill)...`);

  // Insert in batches of 500
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const { error } = await supabase
      .from('hearings')
      .upsert(chunk, { onConflict: 'bill_id,hearing_date', ignoreDuplicates: true });
    if (error) {
      // If upsert fails (no unique constraint), try plain insert
      const { error: err2 } = await supabase.from('hearings').insert(chunk);
      if (err2) console.error(`  Batch insert error at ${i}: ${err2.message}`);
      else inserted += chunk.length;
    } else {
      inserted += chunk.length;
    }
  }

  console.log(`  Inserted ${inserted} hearing rows`);
  return unique;
}

async function backfillHearingDates(billMap) {
  console.log('\nBackfilling bills.hearing_date from hearings table...');

  // For each bill, set hearing_date = earliest hearing date
  const { data: hearingDates, error } = await supabase
    .rpc('backfill_hearing_dates_noop'); // We'll do this via SQL instead

  // Direct SQL approach: update bills.hearing_date from earliest hearing per bill
  // We'll do this via individual updates since we don't have an RPC

  const allBills = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error: err } = await supabase
      .from('hearings')
      .select('bill_id, hearing_date')
      .eq('session', SESSION)
      .order('hearing_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (err) throw err;
    allBills.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Group by bill_id, take earliest date
  const earliest = {};
  for (const h of allBills) {
    if (!earliest[h.bill_id] || h.hearing_date < earliest[h.bill_id]) {
      earliest[h.bill_id] = h.hearing_date;
    }
  }

  let updated = 0;
  const entries = Object.entries(earliest);
  for (let i = 0; i < entries.length; i += 50) {
    const chunk = entries.slice(i, i + 50);
    await Promise.all(chunk.map(async ([billId, date]) => {
      const { error: uerr } = await supabase
        .from('bills')
        .update({ hearing_date: date })
        .eq('bill_id', billId);
      if (!uerr) updated++;
    }));
  }

  console.log(`  Updated hearing_date on ${updated} bills`);
}

// ── FALLBACK: INFER HEARING DATES FROM STATUS CHANGES ────────────────────────
// If the bulk committee meeting approach yields 0 results, fall back to
// re-fetching status changes per bill and extracting committee action dates.
async function inferHearingDatesFromStatus(billMap) {
  console.log('\n--- FALLBACK: Inferring hearing dates from status changes ---');
  console.log('This fetches status changes for each bill with has_public_hearing=true.');
  console.log('This will take ~15-20 minutes for 1,505 bills.\n');

  // Get all bills that have has_public_hearing=true but no hearing_date
  const bills = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number, committee_name')
      .eq('session', SESSION)
      .eq('has_public_hearing', true)
      .is('hearing_date', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    bills.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`  Found ${bills.length} bills needing hearing date inference`);
  if (bills.length === 0) return;

  let inferred = 0;
  const hearingsToInsert = [];

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];
    if (i % 100 === 0) console.log(`  Processing ${i}/${bills.length}...`);

    try {
      const billApiId = bill.bill_id.includes(' ')
        ? bill.bill_id
        : (parseInt(bill.bill_number) < 5000 ? `HB ${bill.bill_number}` : `SB ${bill.bill_number}`);

      const data = await fetchXML('LegislationService.asmx', 'GetLegislativeStatusChangesByBillId', {
        biennium: BIENNIUM,
        billId: billApiId,
        beginDate: '2025-01-01',
        endDate: '2026-12-31',
      });

      const statuses = toArr(data?.ArrayOfLegislativeStatus?.LegislativeStatus);

      // Look for the earliest committee-related action
      // Priority: "public hearing" > "executive action/session" > first "referred to"
      let hearingDate = null;

      // 1. Direct hearing mention
      const hearingSC = statuses.find(s => {
        const line = (s.HistoryLine || s.Status || '').toLowerCase();
        return line.includes('public hearing');
      });
      if (hearingSC) {
        const d = new Date(hearingSC.ActionDate || hearingSC.StatusDate || '');
        if (!isNaN(d)) hearingDate = d.toISOString();
      }

      // 2. Executive session (hearing must have happened before this)
      if (!hearingDate) {
        const execSC = statuses.find(s => {
          const line = (s.HistoryLine || s.Status || '').toLowerCase();
          return line.includes('executive action') || line.includes('executive session');
        });
        if (execSC) {
          const d = new Date(execSC.ActionDate || execSC.StatusDate || '');
          if (!isNaN(d)) hearingDate = d.toISOString();
        }
      }

      // 3. Committee passage ("do pass")
      if (!hearingDate) {
        const passSC = statuses.find(s => {
          const line = (s.HistoryLine || s.Status || '').toLowerCase();
          return line.includes('do pass');
        });
        if (passSC) {
          const d = new Date(passSC.ActionDate || passSC.StatusDate || '');
          if (!isNaN(d)) hearingDate = d.toISOString();
        }
      }

      if (hearingDate) {
        inferred++;
        // Update bill directly
        await supabase
          .from('bills')
          .update({ hearing_date: hearingDate })
          .eq('bill_id', bill.bill_id);

        // Also insert into hearings table
        hearingsToInsert.push({
          bill_id: bill.bill_id,
          committee_name: bill.committee_name || '',
          hearing_date: hearingDate,
          location: '',
          session: SESSION,
        });
      }
    } catch (e) {
      // Skip failures silently
    }

    // Rate limit: ~10 requests/sec
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 1000));
  }

  // Insert hearings in bulk
  if (hearingsToInsert.length > 0) {
    for (let i = 0; i < hearingsToInsert.length; i += 500) {
      const chunk = hearingsToInsert.slice(i, i + 500);
      await supabase.from('hearings').insert(chunk);
    }
  }

  console.log(`  Inferred hearing dates for ${inferred}/${bills.length} bills`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== VECTOR | WA — Hearings Backfill (Step 6C.1) ===\n');

  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.error('ERROR: Set SUPABASE_SERVICE_KEY environment variable.');
    console.error('  Get it from: Supabase Dashboard > Project Settings > API > service_role key');
    process.exit(1);
  }

  const billMap = await loadBillMap();

  // ── APPROACH 1: Bulk committee meeting fetch ──
  console.log('\n--- Approach 1: Bulk committee meeting fetch ---\n');
  let allHearings = [];

  for (const agency of ['House', 'Senate']) {
    const committees = await getActiveCommittees(agency);

    for (const cmte of committees) {
      const name = cmte.Name || cmte.LongName || cmte.Acronym || '';
      if (!name) continue;

      console.log(`  Fetching meetings for ${agency} ${name}...`);
      const meetings = await getCommitteeMeetings(agency, name);
      console.log(`    ${meetings.length} meetings found`);

      const hearings = extractHearingsFromMeetings(meetings, name);
      allHearings.push(...hearings);

      // Rate limit
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\nTotal hearings extracted from committee meetings: ${allHearings.length}`);

  if (allHearings.length > 0) {
    await insertHearings(allHearings, billMap);
    await backfillHearingDates(billMap);
  } else {
    console.log('\nBulk approach returned 0 hearings. Falling back to status-change inference...');
    await inferHearingDatesFromStatus(billMap);
  }

  // ── VERIFICATION ──
  console.log('\n--- Verification ---');
  const { data: hCount } = await supabase
    .from('hearings')
    .select('id', { count: 'exact', head: true })
    .eq('session', SESSION);
  console.log(`Hearings table rows: ${hCount?.length ?? 'check manually'}`);

  const { count: dateCount } = await supabase
    .from('bills')
    .select('bill_id', { count: 'exact', head: true })
    .eq('session', SESSION)
    .not('hearing_date', 'is', null);
  console.log(`Bills with hearing_date: ${dateCount ?? 'check manually'}`);

  const { count: phpCount } = await supabase
    .from('bills')
    .select('bill_id', { count: 'exact', head: true })
    .eq('session', SESSION)
    .eq('has_public_hearing', true);
  console.log(`Bills with has_public_hearing=true: ${phpCount ?? 'check manually'}`);
  console.log(`\nTarget: hearing_date count should be close to has_public_hearing count (${phpCount})`);

  console.log('\n=== Done ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
