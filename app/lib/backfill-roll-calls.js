/**
 * Thread 6 — One-time backfill of historical roll-call + member vote data.
 *
 * Runs the same WA API call that sync-v2.js does (`GetRollCalls` per bill)
 * but ONLY does the new per-member persistence — does not touch bills,
 * trajectory_snapshots, or scoring. scoreBill() is frozen for the 2027
 * calibration session (G5); this script never reaches it.
 *
 * Targets:
 *   - Default: every bill in CURRENT biennium with rollcalls_count > 0 in
 *     the cached `bills.raw_data` JSON. That filters us down to ~500-1000
 *     calls instead of ~3,400.
 *   - Override: pass `--biennium 2023-24` (etc.) to backfill any historical
 *     biennium. The biennium is purely the WA API parameter; bill_ids
 *     already scope the persistence side, no biennium column on roll_calls.
 *
 * Idempotent — re-runs are safe via UNIQUE roll_calls.source_id and the
 * (roll_call_id, member_id) PK on member_votes.
 *
 * Throttling: ~1 request / 200 ms with a polite User-Agent header (already
 * set by the underlying fetchXML helper). Total runtime for the 2025-26
 * biennium expected ~10-15 minutes.
 *
 * USAGE
 *   $env:CURRENT_BIENNIUM = '2025-26'
 *   $env:CURRENT_YEAR     = '2025'
 *   $env:NEXT_PUBLIC_SUPABASE_URL = '...'
 *   $env:SUPABASE_SERVICE_KEY     = '...'
 *   node app/lib/backfill-roll-calls.js
 *   # or: node app/lib/backfill-roll-calls.js --biennium 2023-24 --session 2023-2024
 *
 * Outputs progress to stdout every 25 bills + a final summary.
 */

const path = require('path');
const fs   = require('fs');

// Resolve env from whichever `.env.local` is closer.
//   - Repo root  (vector-app/.env.local)   — when invoked as `node app/lib/backfill...`
//   - App dir    (vector-app/app/.env.local) — when invoked from inside app/
// dotenv.config() does NOT override existing process.env values, so calling
// it twice is safe even if both files exist (the first hit wins per var).
// Defaults  also try the no-path form which reads CWD/.env.
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
  require('dotenv').config(); // CWD fallback
} catch (_) { /* dotenv optional */ }

// ── Args ─────────────────────────────────────────────────────────────────
function parseFlag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const ARG_BIENNIUM = parseFlag('biennium', null);   // '2023-24' format for WA API
const ARG_SESSION  = parseFlag('session',  null);   // '2023-2024' format for DB query
// Allow the same script to backfill any biennium; defaults come from env so
// the GH Action invocation doesn't need to change.
//
// Session derivation matches sync-v2.js:112 — CURRENT_YEAR is the SECOND
// year of the biennium (e.g. YEAR=2026 → SESSION='2025-2026'). Earlier
// version of this script had the math reversed; CLI --session always wins
// over the env fallback so manual invocations stay unambiguous.
const BIENNIUM = ARG_BIENNIUM || process.env.CURRENT_BIENNIUM;
const SESSION  = ARG_SESSION  || (process.env.CURRENT_YEAR
  ? `${parseInt(process.env.CURRENT_YEAR) - 1}-${process.env.CURRENT_YEAR}`
  : null);

if (!BIENNIUM || !/^\d{4}-\d{2}$/.test(BIENNIUM)) {
  console.error(`FATAL: pass --biennium YYYY-YY or set CURRENT_BIENNIUM. Got ${JSON.stringify(BIENNIUM)}`);
  process.exit(2);
}
if (!SESSION || !/^\d{4}-\d{4}$/.test(SESSION)) {
  console.error(`FATAL: pass --session YYYY-YYYY or set CURRENT_YEAR. Got ${JSON.stringify(SESSION)}`);
  process.exit(2);
}

// ── Reuse sync-v2.js helpers via require ─────────────────────────────────
// We re-require sync-v2 only for its module side effects (env validation,
// fetchXML setup) BUT we don't want to actually run runSync(). The module
// exports `runSync` only — getRollCalls/persistRollCalls are file-local.
//
// Cleaner: copy the small bits we need (fetchXML wrapper + a thin clone
// of getRollCalls + persistRollCalls). Avoids accidentally invoking the
// full nightly walk. The persist function itself is ~80 lines, but it
// reads identically to the one in sync-v2.js — keep them in sync if either
// changes (Thread 11 may want to extend the schema).
const { createClient } = require('@supabase/supabase-js');
const xml2js = require('xml2js');

// Accept either env-var name. sync-v2.js reads SUPABASE_URL; the Next.js
// app + browser code reads NEXT_PUBLIC_SUPABASE_URL. .env.local typically
// has only one of them — this script doesn't care which.
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('FATAL: set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in your env or .env.local');
  process.exit(2);
}
if (!SUPABASE_KEY) {
  console.error('FATAL: set SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your env or .env.local');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Must be https — leg.wa.gov hangs http requests instead of redirecting,
// which silently stalled the original first-run. Matches sync-v2.js:85.
const BASE = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov';
const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });

// Per-request timeout — leg.wa.gov occasionally hangs requests instead of
// returning an error. Without this, a single bad bill can stall the whole
// backfill silently. 15 s is generous for an XML response that's normally <1 s.
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchXML(service, method, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${service}/${method}?${qs}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'vector-wa-backfill/1.0' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
    const xml = await res.text();
    return await parser.parseStringPromise(xml);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getRollCalls(billNumber) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetRollCalls', { biennium: BIENNIUM, billNumber });
    const items = data?.ArrayOfRollCall?.RollCall;
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch(e) { return []; }
}

// ── Vote-row parsing (mirrors sync-v2.js — keep in sync) ─────────────────
function _normalizeVoteValue(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (s.startsWith('Y')) return 'YEA';
  if (s.startsWith('N')) return 'NAY';
  if (s.startsWith('A')) return 'ABSENT';
  if (s.startsWith('E')) return 'EXCUSED';
  return s.slice(0, 16);
}

function _parseRollCallRow(billId, rc) {
  const yeas    = parseInt(rc.YeaVotes)    || 0;
  const nays    = parseInt(rc.NayVotes)    || 0;
  const absent  = parseInt(rc.AbsentVotes) || 0;
  const excused = parseInt(rc.ExcusedVotes)|| 0;
  const sourceId = String(rc.RollCallId || rc.SequenceNumber || '').trim();
  if (!sourceId) return null;
  const rawDate = rc.VoteDate || rc.ActionDate || null;
  const voteDate = rawDate ? String(rawDate).split('T')[0] : null;
  if (!voteDate) return null;
  const chamber = (rc.Agency || rc.Chamber || 'House').trim();
  return {
    bill_id: billId, chamber, vote_date: voteDate,
    motion: (rc.Motion || rc.Description || '').trim().slice(0, 240) || null,
    yeas, nays, absent, excused,
    result: yeas > nays ? 'passed' : (yeas + nays > 0 ? 'failed' : null),
    source_id: sourceId,
  };
}

function _parseMemberVotes(rc) {
  const inner = rc.Votes?.Vote || rc.MemberVotes?.MemberVote || rc.Vote;
  if (!inner) return [];
  const arr = Array.isArray(inner) ? inner : [inner];
  return arr.map(v => {
    const memberId   = String(v.MemberId || v.Id || v.LegislatorId || '').trim();
    const memberName = (v.Name || v.MemberName || v.LongName || '').trim();
    const rawVote = (typeof v.Vote === 'object' && v.Vote !== null)
      ? (v.Vote._ ?? v.Vote.value ?? '')
      : (v.Vote ?? v.VoteValue ?? v.Position ?? '');
    const vote = _normalizeVoteValue(rawVote);
    const party = (v.Party || '').trim().toUpperCase().slice(0, 4) || null;
    if (!memberId || !memberName || !vote) return null;
    return { member_id: memberId, member_name: memberName, party, vote };
  }).filter(Boolean);
}

let SHAPE_LOGGED = false;
async function persistRollCalls(billId, rollCalls) {
  if (!rollCalls.length) return { rc: 0, mv: 0, errs: [] };
  let rc = 0, mv = 0;
  const errs = [];
  for (const item of rollCalls) {
    const row = _parseRollCallRow(billId, item);
    if (!row) continue;
    const { data: rcRow, error: rcErr } = await supabase
      .from('roll_calls')
      .upsert(row, { onConflict: 'source_id' })
      .select('id')
      .single();
    if (rcErr) { errs.push(`rc[${row.source_id}]: ${rcErr.message}`); continue; }
    rc++;
    const members = _parseMemberVotes(item);
    if (!SHAPE_LOGGED && members.length === 0 && (row.yeas + row.nays) > 0) {
      SHAPE_LOGGED = true;
      console.warn(`  [shape] No member rows parsed for ${billId} RC ${row.source_id}; ` +
        `RollCall keys: ${Object.keys(item).join(',')}; ` +
        `Votes child: ${item.Votes ? Object.keys(item.Votes).join(',') : 'absent'}`);
    }
    if (!members.length) continue;
    const memberRows = members.map(m => ({ ...m, roll_call_id: rcRow.id }));
    const { error: mvErr } = await supabase
      .from('member_votes')
      .upsert(memberRows, { onConflict: 'roll_call_id,member_id' });
    if (mvErr) { errs.push(`mv[${row.source_id}]: ${mvErr.message}`); continue; }
    mv += memberRows.length;
  }
  return { rc, mv, errs };
}

// ── Main backfill walk ────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Backfill — biennium=${BIENNIUM} session=${SESSION}`);

  // Pull every bill in the session that has at least one rollcall captured
  // in the cached raw_data. Filters from ~3,400 → ~500-1000.
  let bills = [];
  let page = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number, raw_data')
      .eq('session', SESSION)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) { console.error(`Bill fetch failed: ${error.message}`); process.exit(1); }
    if (!data || data.length === 0) break;
    bills = bills.concat(data);
    if (data.length < PAGE) break;
    page++;
  }

  const targets = bills.filter(b => (b.raw_data?.rollcalls_count || 0) > 0);
  console.log(`  ${bills.length} bills in ${SESSION}; ${targets.length} have ≥1 roll call recorded`);

  let totalRC = 0, totalMV = 0;
  const errors = [];
  let i = 0;
  const start = Date.now();
  for (const b of targets) {
    i++;
    try {
      const rcs = await getRollCalls(b.bill_number);
      const { rc, mv, errs } = await persistRollCalls(b.bill_id, rcs);
      totalRC += rc;
      totalMV += mv;
      if (errs.length) errors.push({ bill: b.bill_number, errs });
    } catch (e) {
      errors.push({ bill: b.bill_number, errs: [`fatal: ${e.message}`] });
    }
    // Log the first bill explicitly + every 25th after, so a hung first call
    // can't masquerade as "still warming up". Also log every bill that
    // produced an error so failures aren't hidden between batch boundaries.
    if (i === 1 || i % 25 === 0) {
      const mins = ((Date.now() - start) / 60000).toFixed(1);
      console.log(`  [${i}/${targets.length}] ${totalRC} roll calls, ${totalMV} member votes, ${errors.length} bill-errors (${mins} min)`);
    }
    // Polite throttle — WA service is a public asmx and hates bursts.
    await new Promise(r => setTimeout(r, 200));
  }

  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`\n[${new Date().toISOString()}] Backfill done: ${totalRC} roll calls, ${totalMV} member votes, ${errors.length} bills with errors (${mins} min)`);
  if (errors.length > 0 && errors.length <= 20) {
    for (const e of errors) console.log(`  ${e.bill}: ${e.errs.join(' | ')}`);
  } else if (errors.length > 20) {
    console.log(`  (${errors.length} errors — first 5: ${JSON.stringify(errors.slice(0, 5))})`);
  }
  process.exit(0);
}

main().catch(e => { console.error(`FATAL: ${e.message}`); process.exit(1); });
